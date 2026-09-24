/**
 * AES-256-GCM seal for CRM agent login passwords.
 *
 * Key material is only CRM_CREDENTIAL_KEY (a documented dev placeholder
 * outside production). Random 12-byte IV, auth tag. Ciphertext columns are
 * useless without that key. Never log plaintext passwords.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_SALT = 'atmosphere/crm-agent-credentials/v1';

let derivedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (!derivedKey) {
    derivedKey = scryptSync(config.crmCredentials.keyMaterial, KEY_SALT, KEY_BYTES);
  }
  return derivedKey;
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

export function openCrmPassword(row: SealedPassword): string {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.cipher, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** Non-reversible fingerprint for change detection — never a password substitute. */
export function crmPasswordFingerprint(password: string): string {
  return createHash('sha256').update(`crm-pw:${password}`, 'utf8').digest('hex').slice(0, 16);
}
