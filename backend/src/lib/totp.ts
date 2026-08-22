import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'Atmosphere Internal';

export function randomTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('invalid_totp_secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: string, unixSec: number): { code: string; counter: bigint } {
  const counter = BigInt(Math.floor(unixSec / TOTP_PERIOD_SEC));
  return { code: hotp(decodeBase32(secret), counter), counter };
}

export function verifyTotp(
  secret: string,
  code: string,
  opts?: { nowSec?: number; minCounter?: bigint },
): { ok: true; counter: bigint } | { ok: false } {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return { ok: false };
  const now = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const min = opts?.minCounter ?? -1n;
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const at = totpAt(secret, now + delta * TOTP_PERIOD_SEC);
    if (at.counter <= min) continue;
    if (codesEqual(at.code, trimmed)) return { ok: true, counter: at.counter };
  }
  return { ok: false };
}

export function otpauthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const issuer = encodeURIComponent(TOTP_ISSUER);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SEC}`;
}

function hotp(secret: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  let n = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function codesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
