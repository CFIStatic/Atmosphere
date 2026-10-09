/**
 * AES-256-GCM seal for CRM agent login passwords.
 *
 * Key material is only CRM_CREDENTIAL_KEY (a documented dev placeholder
 * outside production). Random 12-byte IV, auth tag. Ciphertext columns are
 * useless without that key. Never log plaintext passwords.
 *
 * Rotation: set the new key as CRM_CREDENTIAL_KEY and list the old one(s) in
 * CRM_CREDENTIAL_KEY_PREVIOUS (comma or newline separated). Rows sealed with a
 * previous key still open (GCM's auth tag rejects a wrong key, so each key is
 * tried in turn) and are re-sealed with the current key the next time the
 * agent loads them (credentialsStore.ts). Drop the previous key once every
 * connected CRM has been used, or ask admins to reconnect.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_SALT = 'atmosphere/crm-agent-credentials/v1';

export const PREVIOUS_CRM_KEYS_ENV = 'CRM_CREDENTIAL_KEY_PREVIOUS';

const derived = new Map<string, Buffer>();

function derive(material: string): Buffer {
  let key = derived.get(material);
  if (!key) {
    key = scryptSync(material, KEY_SALT, KEY_BYTES);
    derived.set(material, key);
  }
  return key;
}

function encryptionKey(): Buffer {
  return derive(config.crmCredentials.keyMaterial);
}

function previousKeys(): Buffer[] {
  return String(process.env[PREVIOUS_CRM_KEYS_ENV] ?? '')
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v && v !== config.crmCredentials.keyMaterial)
    .map(derive);
}

export type SealedPassword = {
  cipher: string;
  iv: string;
  tag: string;
};

export function sealCrmPassword(password: string): SealedPassword {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return {
    cipher: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

function openWith(key: Buffer, row: SealedPassword): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.cipher, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Plaintext plus whether it was sealed with a previous key (and so should be
 * re-sealed). Throws when no configured key opens it.
 */
export function openCrmPasswordDetailed(row: SealedPassword): { password: string; stale: boolean } {
  try {
    return { password: openWith(encryptionKey(), row), stale: false };
  } catch (err) {
    for (const key of previousKeys()) {
      try {
        return { password: openWith(key, row), stale: true };
      } catch {
        // Try the next retired key.
      }
    }
    throw err;
  }
}

export function openCrmPassword(row: SealedPassword): string {
  return openCrmPasswordDetailed(row).password;
}

/** Non-reversible fingerprint for change detection — never a password substitute. */
export function crmPasswordFingerprint(password: string): string {
  return createHash('sha256').update(`crm-pw:${password}`, 'utf8').digest('hex').slice(0, 16);
}
