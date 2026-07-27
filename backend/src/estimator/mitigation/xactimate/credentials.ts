import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../../../config.js';

/**
 * The Xactimate credential vault.
 *
 * The same reasoning that governs PIN storage in `deviceCrypto.ts` applies here,
 * with one difference that makes it stricter: a PIN hash is one-way, but a
 * password that has to be replayed into a login form must be *recoverable*. That
 * rules out hashing and puts the entire burden on key custody.
 *
 * So:
 *
 *   - **Not storing it is the default.** `storageMode: 'session'` keeps the
 *     password in memory for one operation and zeroes the buffer afterwards.
 *     Nothing reaches disk, and a database leak yields nothing because there is
 *     nothing there. Storage is opt-in, per user, for unattended runs only.
 *   - **The key never touches the database.** `XACTIMATE_ENC_KEY` is an env-only
 *     secret. A dump of the ciphertext without it is inert, exactly as the device
 *     pepper makes the PIN table inert.
 *   - **Per-record salt and IV.** AES-256-GCM with a fresh 96-bit IV per record;
 *     the auth tag is verified on open, so tampered ciphertext fails closed
 *     rather than decrypting to garbage that gets typed into a login form.
 *   - **Bound to the owner.** The user id is authenticated additional data, so a
 *     row moved between users fails to decrypt instead of silently working.
 *   - **Never leaves the server.** No route returns a credential, in any form.
 *     The API exposes only "connected / not connected" and the username.
 */

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96 bits, the GCM-recommended size
const TAG_BYTES = 16;

/** Envelope written to storage. Every field is safe to persist. */
export interface SealedCredential {
  /** Version tag so the format can change without breaking stored rows. */
  v: 1;
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
}

export class VaultUnavailableError extends Error {
  readonly code = 'vault_unavailable';
  constructor() {
    super(
      'Credential storage is not configured on this server. Set XACTIMATE_ENC_KEY, or connect Xactimate in session-only mode.',
    );
    this.name = 'VaultUnavailableError';
  }
}

export class VaultOpenError extends Error {
  readonly code = 'vault_open_failed';
  constructor() {
    // Deliberately uninformative: distinguishing "wrong key" from "tampered
    // data" for a caller is a gift to whoever is probing.
    super('Stored Xactimate credentials could not be read. Reconnect the account.');
    this.name = 'VaultOpenError';
  }
}

/** Whether at-rest storage is available at all on this deployment. */
export function isVaultConfigured(): boolean {
  return Boolean(config.xactimate.encryptionKey);
}

/**
 * Derive the per-record key. scrypt over the env secret with a per-record salt,
 * so two rows holding the same password produce unrelated ciphertext and a
 * cracking attempt has to be repeated per row.
 */
function deriveKey(salt: Buffer): Buffer {
  const secret = config.xactimate.encryptionKey;
  if (!secret) throw new VaultUnavailableError();
  return scryptSync(secret, salt, KEY_BYTES, { maxmem: 64 * 1024 * 1024 });
}

/**
 * Seal a password for storage.
 *
 * @param userId Bound as additional authenticated data — a row copied to another
 *               user will not open.
 */
export function sealCredential(plaintext: string, userId: string): SealedCredential {
  if (!plaintext) throw new Error('Refusing to seal an empty credential.');

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(userId, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  key.fill(0);

  return {
    v: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

/** Open a sealed credential. Throws rather than returning a partial result. */
export function openCredential(sealed: SealedCredential, userId: string): string {
  if (sealed?.v !== 1) throw new VaultOpenError();

  try {
    const salt = Buffer.from(sealed.salt, 'hex');
    const iv = Buffer.from(sealed.iv, 'hex');
    const tag = Buffer.from(sealed.tag, 'hex');
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new VaultOpenError();
    }

    const key = deriveKey(salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'hex')),
      decipher.final(),
    ]);

    key.fill(0);
    const result = plaintext.toString('utf8');
    plaintext.fill(0);
    return result;
  } catch (err) {
    if (err instanceof VaultUnavailableError) throw err;
    throw new VaultOpenError();
  }
}

/* ------------------------------------------------------------------ *
 * Session-scoped credentials
 * ------------------------------------------------------------------ */

/**
 * A password held for exactly one operation.
 *
 * `use()` hands the plaintext to a callback and wipes the backing buffer as soon
 * as the callback settles, success or failure. There is no getter — the only way
 * to read the secret is inside a scope that provably ends.
 *
 * This is not perfect (V8 may have copied the string during parsing, and only a
 * native secure-string type would fix that), but it removes the long-lived
 * in-process copy that would otherwise sit in a heap dump for the life of the
 * server.
 */
export class SessionCredential {
  #buffer: Buffer | null;

  constructor(plaintext: string) {
    this.#buffer = Buffer.from(plaintext, 'utf8');
  }

  get isLive(): boolean {
    return this.#buffer !== null;
  }

  async use<T>(fn: (plaintext: string) => Promise<T>): Promise<T> {
    if (!this.#buffer) throw new Error('This credential has already been consumed.');
    const plaintext = this.#buffer.toString('utf8');
    try {
      return await fn(plaintext);
    } finally {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.#buffer) {
      this.#buffer.fill(0);
      this.#buffer = null;
    }
  }
}

/**
 * A short-lived in-memory store for session credentials, keyed by user.
 *
 * Entries self-destruct after `ttlMs` whether or not they were used, so a
 * connect flow the user abandons does not leave a password resident. It is
 * deliberately process-local and not shared across instances: a credential that
 * survives a restart is a credential that was persisted.
 */
export class SessionCredentialStore {
  readonly #entries = new Map<string, { credential: SessionCredential; timer: NodeJS.Timeout }>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  put(userId: string, plaintext: string): void {
    this.drop(userId);
    const credential = new SessionCredential(plaintext);
    const timer = setTimeout(() => this.drop(userId), this.ttlMs);
    timer.unref?.();
    this.#entries.set(userId, { credential, timer });
  }

  take(userId: string): SessionCredential | null {
    const entry = this.#entries.get(userId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.#entries.delete(userId);
    return entry.credential;
  }

  has(userId: string): boolean {
    return this.#entries.has(userId);
  }

  drop(userId: string): void {
    const entry = this.#entries.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.credential.destroy();
    this.#entries.delete(userId);
  }

  /** Called on revocation and on shutdown. */
  clear(): void {
    for (const userId of [...this.#entries.keys()]) this.drop(userId);
  }
}

export const sessionCredentials = new SessionCredentialStore();

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

const SECRET_KEYS = /^(password|passwd|secret|token|credential|pin|otp|mfa|auth)/i;

/**
 * Strip secrets before anything is logged.
 *
 * Driver errors carry request context, and the one place a password reliably
 * leaks is an exception message that got logged. Everything on its way to a log
 * goes through here.
 */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out as T;
}

/** Constant-time comparison for any state/nonce echoed back by a driver. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
