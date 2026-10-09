/**
 * AES-256-GCM seal for Computer's saved sign-ins (Logins page): the username
 * and password a company saved so Computer can sign itself back in.
 *
 * Key material is only COMPUTER_CREDENTIAL_KEY: a long random string (at
 * least 32 characters, e.g. `openssl rand -base64 48`), never stored in the
 * database or git. It is stretched with scrypt (as for CRM credentials, with
 * its own salt). Without it, saving passwords is off and nothing breaks.
 *
 * Each sealed value is "v1.<iv>.<tag>.<ciphertext>" (base64url) with a random
 * 12-byte IV, and is bound (AAD) to its org, saved site and field, so a value
 * copied onto another row does not open. Never log or return plaintext.
 *
 * Rotation: put the old key in COMPUTER_CREDENTIAL_KEY_PREVIOUS (several may be
 * listed, comma or newline separated) and the new one in
 * COMPUTER_CREDENTIAL_KEY. Rows sealed with a previous key still open (each row
 * records its key's fingerprint), and are re-sealed with the current key the
 * next time they are used or by `npm run rotate:computer-credentials`. Once no
 * row carries an old fingerprint, drop the previous key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { cleanEnvSecret } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_SALT = 'atmosphere/computer-login-credentials/v1';
export const CREDENTIAL_KEY_ENV = 'COMPUTER_CREDENTIAL_KEY';
export const PREVIOUS_CREDENTIAL_KEYS_ENV = 'COMPUTER_CREDENTIAL_KEY_PREVIOUS';
const MIN_KEY_CHARS = 32;

/** Customer-facing: why the save-password option is off. */
export const CREDENTIALS_OFF_MESSAGE =
  "Saving passwords isn't turned on for your account yet. You can still sign in yourself in the browser.";

export type CredentialField = 'username' | 'password';

type KeyState = { key: Buffer; fingerprint: string };

const derived = new Map<string, KeyState>();

function material(): string {
  return cleanEnvSecret(CREDENTIAL_KEY_ENV, process.env[CREDENTIAL_KEY_ENV]);
}

function previousMaterials(): string[] {
  const raw = cleanEnvSecret(PREVIOUS_CREDENTIAL_KEYS_ENV, process.env[PREVIOUS_CREDENTIAL_KEYS_ENV]);
  return raw
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length >= MIN_KEY_CHARS);
}

function derive(m: string): KeyState {
  let state = derived.get(m);
  if (!state) {
    state = {
      key: scryptSync(m, KEY_SALT, 32),
      fingerprint: createHash('sha256').update(`computer-credential-key:${m}`, 'utf8').digest('hex').slice(0, 16),
    };
    derived.set(m, state);
  }
  return state;
}

/** True when COMPUTER_CREDENTIAL_KEY is set (and long enough). */
export function credentialsEnabled(): boolean {
  return material().length >= MIN_KEY_CHARS;
}

function keyState(): KeyState {
  const m = material();
  if (m.length < MIN_KEY_CHARS) throw new CredentialsOffError();
  return derive(m);
}

/** The key (current or previous) whose fingerprint matches, or null. */
function keyForFingerprint(fingerprint: string): KeyState | null {
  const current = keyState();
  if (fingerprint === current.fingerprint) return current;
  for (const m of previousMaterials()) {
    const prev = derive(m);
    if (prev.fingerprint === fingerprint) return prev;
  }
  return null;
}

/** Which key sealed a row (not secret); a mismatch means the key was changed. */
export function credentialKeyFingerprint(): string {
  return keyState().fingerprint;
}

/** True when a row sealed under this fingerprint can be opened (current or a listed previous key). */
export function canOpenFingerprint(fingerprint: string): boolean {
  if (!credentialsEnabled()) return false;
  return keyForFingerprint(fingerprint) !== null;
}

/** True when a readable row was sealed with a previous key and should be re-sealed. */
export function needsReseal(fingerprint: string): boolean {
  return canOpenFingerprint(fingerprint) && fingerprint !== credentialKeyFingerprint();
}

export class CredentialsOffError extends Error {
  constructor() {
    super(CREDENTIALS_OFF_MESSAGE);
    this.name = 'CredentialsOffError';
  }
}

function aad(orgId: string, loginId: string, field: CredentialField): Buffer {
  return Buffer.from(`computer-login:${orgId}:${loginId}:${field}`, 'utf8');
}

export function sealCredential(plaintext: string, orgId: string, loginId: string, field: CredentialField): string {
  const { key } = keyState();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(orgId, loginId, field));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/**
 * Plaintext, or throws (wrong key, tampered value, or another row's value).
 * Pass the row's key fingerprint to open values sealed with a previous key;
 * without it only the current key is tried.
 */
export function openCredential(
  sealed: string,
  orgId: string,
  loginId: string,
  field: CredentialField,
  fingerprint?: string,
): string {
  const state = fingerprint ? keyForFingerprint(fingerprint) : keyState();
  if (!state) throw new Error('Saved sign-in is not readable.');
  const { key } = state;
  const parts = String(sealed).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Saved sign-in is not readable.');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1], 'base64url'));
  decipher.setAAD(aad(orgId, loginId, field));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Never echo crypto internals or input.
    throw new Error('Saved sign-in is not readable.');
  }
}

/**
 * Re-seal a row's username and password with the current key. Returns the new
 * sealed values, or null when the row is already current. Throws as
 * openCredential does when the row can't be opened.
 */
export function resealCredential(row: {
  org_id: string;
  login_id: string;
  username_sealed: string;
  password_sealed: string;
  key_fingerprint: string;
}): { username_sealed: string; password_sealed: string; key_fingerprint: string } | null {
  if (row.key_fingerprint === credentialKeyFingerprint()) return null;
  const username = openCredential(row.username_sealed, row.org_id, row.login_id, 'username', row.key_fingerprint);
  const password = openCredential(row.password_sealed, row.org_id, row.login_id, 'password', row.key_fingerprint);
  return {
    username_sealed: sealCredential(username, row.org_id, row.login_id, 'username'),
    password_sealed: sealCredential(password, row.org_id, row.login_id, 'password'),
    key_fingerprint: credentialKeyFingerprint(),
  };
}
