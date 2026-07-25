import { randomBytes, createHash, scryptSync } from 'node:crypto';
import { config } from '../config.js';

/**
 * Cryptography for device-bound PIN unlock.
 *
 * A 4-digit PIN has only 10,000 possible values, so it is never treated as a
 * standalone credential. It unlocks a *specific device* that already completed a
 * full email + password login, and three things must come together before a
 * session is issued:
 *
 *   1. the device secret — 32 random bytes held only in an httpOnly cookie and
 *      never stored server-side (the database keeps just its SHA-256);
 *   2. the PIN — checked against a scrypt hash inside the database, behind an
 *      atomic lockout counter (5 tries, then a 15-minute freeze);
 *   3. the server pepper — an env-only secret mixed into the PIN hash, so it
 *      never lives in the database at all.
 *
 * The consequence that matters: a full database leak yields nothing usable. No
 * session token is stored at rest, and the PIN hashes cannot be swept offline
 * without the pepper even though the PIN space is tiny.
 */

/** PINs are exactly 4 digits, matching the banking-app interaction users expect. */
export const PIN_LENGTH = 4;

/** Wrong PINs allowed before the device is frozen for 15 minutes. */
export const MAX_PIN_ATTEMPTS = 5;

const KEY_BYTES = 32;
const SECRET_BYTES = 32;
const SALT_BYTES = 16;

/** Mint a fresh device secret. Base64url so it is cookie-safe. */
export function newDeviceSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/** Random per-device salt for the PIN hash. */
export function newPinSalt(): string {
  return randomBytes(SALT_BYTES).toString('hex');
}

/**
 * What the database stores in place of the device secret. A fast hash is correct
 * here: the input is 32 uniformly random bytes, so there is no guessable
 * pre-image for a slow hash to protect.
 */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Derive the stored PIN hash. scrypt is deliberately slow, and the pepper means
 * an attacker holding only the database cannot mount the trivial 10,000-guess
 * sweep that a short PIN would otherwise invite.
 */
export function hashPin(pin: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, 'hex');
  const input = `${pin}:${config.device.pepper}`;
  // N=16384, r=8, p=1 → ~16 MB of memory per derivation.
  return scryptSync(input, salt, KEY_BYTES, { maxmem: 64 * 1024 * 1024 }).toString('hex');
}

/** The device cookie carries `<deviceId>.<secret>`. */
export function encodeDeviceCookie(deviceId: string, secret: string): string {
  return `${deviceId}.${secret}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict parsing: anything malformed is treated as "no device", never as partial trust. */
export function parseDeviceCookie(
  value: string | undefined,
): { deviceId: string; secret: string } | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const deviceId = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!UUID_RE.test(deviceId) || secret.length < 32) return null;
  return { deviceId, secret };
}
