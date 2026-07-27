import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import type { Provider } from './types.js';

/**
 * Encrypted credential vault for the third-party systems the estimator drives.
 *
 * The agent signs in to DocuSketch, Dash, and Xactimate as the organization, so
 * it necessarily holds real credentials. Three things keep that from being a
 * liability:
 *
 *   1. Secrets are sealed with AES-256-GCM before they reach Postgres. The
 *      database stores ciphertext, IV, and auth tag — never a usable secret.
 *   2. The key lives only in `ESTIMATOR_CREDENTIAL_KEY`, an env var. It is
 *      deliberately absent from the database, so a database leak alone yields
 *      nothing: the same separation the device PIN pepper relies on.
 *   3. Nothing ever travels back to the browser. The API returns metadata
 *      (which providers are configured, who configured them, when) and a
 *      fingerprint — never the secret, not even to the user who set it.
 *
 * GCM is used rather than CBC because it authenticates: a tampered row fails to
 * decrypt instead of silently yielding garbage that we would then post to a
 * vendor's login form.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the GCM-recommended nonce length
const KEY_BYTES = 32;

/** What a provider needs to authenticate. Shapes differ per vendor. */
export interface ProviderSecret {
  /** Username / email, for vendors that use a password login. */
  username?: string;
  password?: string;
  /** Token / API-key auth, preferred wherever the vendor offers it. */
  apiKey?: string;
  /** Xactimate & Dash both scope requests to a tenant or company id. */
  accountId?: string;
  /** Per-org override of the vendor host, when the org is on its own tenant. */
  baseUrl?: string;
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  /** Non-reversible tag, so the UI can show "…ends 4f2a" without the secret. */
  fingerprint: string;
}

let cachedKey: Buffer | null = null;

/**
 * Resolve the encryption key, accepting either base64 or hex so operators can
 * paste whatever `openssl rand` gave them. A wrong-length key is a boot-time
 * misconfiguration, so it throws loudly rather than degrading.
 */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = config.estimator.credentialKey;
  if (!raw) {
    throw new HttpError(
      503,
      'Credential storage is not configured on this server (ESTIMATOR_CREDENTIAL_KEY).',
      'credential_key_missing',
    );
  }

  const decoded = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new HttpError(
      503,
      'ESTIMATOR_CREDENTIAL_KEY must decode to 32 bytes — generate one with `openssl rand -base64 32`.',
      'credential_key_invalid',
    );
  }

  cachedKey = decoded;
  return decoded;
}

/** True when this server can seal and open secrets at all. */
export function credentialStorageAvailable(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * A short, stable, non-reversible tag for a secret. Derived from the key as
 * well as the secret so the same password stored by two different deployments
 * does not produce a matching fingerprint.
 */
function fingerprint(plaintext: string): string {
  return createHash('sha256')
    .update(encryptionKey())
    .update(plaintext, 'utf8')
    .digest('hex')
    .slice(0, 8);
}

export function sealSecret(secret: ProviderSecret): SealedSecret {
  const plaintext = JSON.stringify(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    fingerprint: fingerprint(plaintext),
  };
}

export function openSecret(sealed: SealedSecret): ProviderSecret {
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(sealed.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));

  let plaintext: string;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Authentication failure: either the row was tampered with or the key was
    // rotated out from under it. Both are operator problems, not user errors.
    throw new HttpError(
      500,
      'Stored credential could not be decrypted. It may have been saved under a different ESTIMATOR_CREDENTIAL_KEY — re-enter it.',
      'credential_undecryptable',
    );
  }

  return JSON.parse(plaintext) as ProviderSecret;
}

/**
 * Reject secrets that carry nothing usable, so a typo in the setup form fails
 * at save time instead of halfway through a run.
 */
export function assertUsableSecret(provider: Provider, secret: ProviderSecret): void {
  const hasPassword = Boolean(secret.username && secret.password);
  const hasApiKey = Boolean(secret.apiKey);
  if (!hasPassword && !hasApiKey) {
    throw new HttpError(
      400,
      `${provider} needs either an API key or a username and password.`,
      'credential_incomplete',
    );
  }
}

/** Strip secret material from anything on its way to a log or an API response. */
export function redact(value: unknown): unknown {
  const SENSITIVE = /^(password|apikey|api_key|token|secret|authorization|accesstoken)$/i;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? '[redacted]' : redact(v),
      ]),
    );
  }
  return value;
}
