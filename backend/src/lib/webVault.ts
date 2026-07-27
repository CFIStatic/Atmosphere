import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

/**
 * Sealing for the passwords Atmosphere signs into other people's websites with.
 *
 * Unlike an account password — which we never store, because Supabase Auth
 * only ever keeps a bcrypt hash — a site credential has to be *replayed* to a
 * third party, so it must be recoverable. That makes it the one secret in the
 * system that lives at rest, and the reason it is encrypted rather than hashed.
 *
 * The key is derived from WEB_ACCESS_KEY, which lives only in the server
 * environment. Postgres holds ciphertext and nothing else, so a database leak
 * on its own yields no working logins. Rotating WEB_ACCESS_KEY invalidates
 * every stored credential — which is exactly what you want if it is exposed;
 * members simply re-enter the passwords.
 *
 * AES-256-GCM is authenticated: a tampered ciphertext fails to open rather
 * than decrypting to garbage that gets typed into a login form.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits — the size GCM is specified for.

/** Bumped if the derivation ever changes, so old rows stay identifiable. */
export const CURRENT_KEY_VERSION = 1;

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/**
 * A fixed salt is correct here: it separates this key from other uses of the
 * same secret, and there is exactly one key to derive — nothing a per-record
 * salt would protect against.
 */
function derivedKey(): Buffer {
  if (!config.webAccess.encryptionKey) {
    throw new Error('WEB_ACCESS_KEY is not configured');
  }
  return scryptSync(config.webAccess.encryptionKey, 'atmosphere.web-access.v1', KEY_BYTES, {
    maxmem: 64 * 1024 * 1024,
  });
}

export function sealSecret(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Throws when the key has rotated or the record was tampered with. Callers
 * surface that as "re-enter the password", never as a run failure the user
 * cannot act on.
 */
export function openSecret(sealed: SealedSecret): string {
  const decipher = createDecipheriv('aes-256-gcm', derivedKey(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
