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
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { cleanEnvSecret } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_SALT = 'atmosphere/computer-login-credentials/v1';
export const CREDENTIAL_KEY_ENV = 'COMPUTER_CREDENTIAL_KEY';
const MIN_KEY_CHARS = 32;

/** Customer-facing: why the save-password option is off. */
export const CREDENTIALS_OFF_MESSAGE =
  "Saving passwords isn't turned on for your account yet. You can still sign in yourself in the browser.";

export type CredentialField = 'username' | 'password';

let cached: { material: string; key: Buffer; fingerprint: string } | null = null;

function material(): string {
  return cleanEnvSecret(CREDENTIAL_KEY_ENV, process.env[CREDENTIAL_KEY_ENV]);
}

/** True when COMPUTER_CREDENTIAL_KEY is set (and long enough). */
export function credentialsEnabled(): boolean {
  return material().length >= MIN_KEY_CHARS;
}

function keyState(): { key: Buffer; fingerprint: string } {
  const m = material();
  if (m.length < MIN_KEY_CHARS) throw new CredentialsOffError();
  if (!cached || cached.material !== m) {
    cached = {
      material: m,
      key: scryptSync(m, KEY_SALT, 32),
      fingerprint: createHash('sha256').update(`computer-credential-key:${m}`, 'utf8').digest('hex').slice(0, 16),
    };
  }
  return cached;
}

/** Which key sealed a row (not secret); a mismatch means the key was changed. */
export function credentialKeyFingerprint(): string {
  return keyState().fingerprint;
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

/** Plaintext, or throws (wrong key, tampered value, or another row's value). */
export function openCredential(sealed: string, orgId: string, loginId: string, field: CredentialField): string {
  const { key } = keyState();
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
