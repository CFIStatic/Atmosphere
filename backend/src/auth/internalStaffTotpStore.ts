import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_SALT = 'atmosphere/internal-totp/v1';

let derivedKey: Buffer | null = null;
function encryptionKey(): Buffer {
  if (!derivedKey) {
    derivedKey = scryptSync(config.device.pepper, KEY_SALT, KEY_BYTES);
  }
  return derivedKey;
}

export function encryptTotpSecret(secret: string): { cipher: string; iv: string; tag: string } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    cipher: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptTotpSecret(row: { cipher: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.cipher, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

export async function loadEnrolledTotp(email: string): Promise<{
  secret: string;
  lastCounter: bigint;
} | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from('internal_staff_totp')
    .select('secret_cipher, secret_iv, secret_tag, last_counter')
    .eq('email', email)
    .maybeSingle();
  if (error) {
    logger.warn('internal_totp_load_failed', { email, detail: error.message });
    return null;
  }
  if (!data) return null;
  return {
    secret: decryptTotpSecret({
      cipher: String(data.secret_cipher),
      iv: String(data.secret_iv),
      tag: String(data.secret_tag),
    }),
    lastCounter: BigInt(data.last_counter ?? -1),
  };
}

export async function saveEnrolledTotp(email: string, secret: string, lastCounter: bigint): Promise<void> {
  const admin = createAdminClient();
  if (!admin) throw new Error('missing_service_role');
  const sealed = encryptTotpSecret(secret);
  const { error } = await admin.from('internal_staff_totp').upsert(
    {
      email,
      secret_cipher: sealed.cipher,
      secret_iv: sealed.iv,
      secret_tag: sealed.tag,
      last_counter: Number(lastCounter),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email' },
  );
  if (error) {
    logger.warn('internal_totp_save_failed', { email, detail: error.message });
    throw error;
  }
}
