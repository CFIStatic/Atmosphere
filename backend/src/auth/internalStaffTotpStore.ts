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
  firstName: string | null;
  lastName: string | null;
} | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const full = await admin
    .from('internal_staff_totp')
    .select('secret_cipher, secret_iv, secret_tag, last_counter, first_name, last_name')
    .eq('email', email)
    .maybeSingle();
  const { data, error } = full.error
    ? await admin
        .from('internal_staff_totp')
        .select('secret_cipher, secret_iv, secret_tag, last_counter')
        .eq('email', email)
        .maybeSingle()
    : full;
  if (error) {
    logger.warn('internal_totp_load_failed', { email, detail: error.message });
    return null;
  }
  if (!data) return null;
  const row = data as {
    secret_cipher: string;
    secret_iv: string;
    secret_tag: string;
    last_counter: number | string;
    first_name?: string | null;
    last_name?: string | null;
  };
  return {
    secret: decryptTotpSecret({
      cipher: String(row.secret_cipher),
      iv: String(row.secret_iv),
      tag: String(row.secret_tag),
    }),
    lastCounter: BigInt(row.last_counter ?? -1),
    firstName: typeof row.first_name === 'string' && row.first_name.trim() ? row.first_name : null,
    lastName: typeof row.last_name === 'string' && row.last_name.trim() ? row.last_name : null,
  };
}

export async function saveEnrolledTotp(
  email: string,
  secret: string,
  lastCounter: bigint,
  names?: { firstName?: string; lastName?: string },
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) throw new Error('missing_service_role');
  const sealed = encryptTotpSecret(secret);
  const row: Record<string, unknown> = {
    email,
    secret_cipher: sealed.cipher,
    secret_iv: sealed.iv,
    secret_tag: sealed.tag,
    last_counter: Number(lastCounter),
    updated_at: new Date().toISOString(),
  };
  if (names?.firstName?.trim()) row.first_name = names.firstName.trim();
  if (names?.lastName?.trim()) row.last_name = names.lastName.trim();
  const { error } = await admin.from('internal_staff_totp').upsert(row, { onConflict: 'email' });
  if (error && (row.first_name || row.last_name)) {
    delete row.first_name;
    delete row.last_name;
    const retry = await admin.from('internal_staff_totp').upsert(row, { onConflict: 'email' });
    if (!retry.error) return;
    logger.warn('internal_totp_save_failed', { email, detail: retry.error.message });
    throw retry.error;
  }
  if (error) {
    logger.warn('internal_totp_save_failed', { email, detail: error.message });
    throw error;
  }
}
