import { createHash, randomBytes } from 'node:crypto';

/** Raw share token length (bytes before base64url encoding). */
const TOKEN_BYTES = 32;

/** Mint a URL-safe share token and its SHA-256 hex hash. */
export function mintShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashShareToken(token) };
}

/** Hash a raw token the same way minting does. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Loose check before we hash — reject obvious garbage early. */
export function looksLikeShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,128}$/.test(token);
}
