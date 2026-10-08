import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * One answer to "who is this visitor?" for legal records, logs and rate limits.
 *
 * Production path: browser -> Cloudflare -> Railway edge -> our nginx -> API.
 * Railway's edge overwrites X-Real-IP and X-Forwarded-For on every request
 * (caller-sent copies never reach us) and, behind Cloudflare, fills X-Real-IP
 * from CF-Connecting-IP. Our nginx front ends relay that X-Real-IP unchanged.
 * The leftmost X-Forwarded-For entry is Cloudflare's edge, and `req.ip`
 * (trust proxy = 1) is Railway's internal 100.64.x hop, so neither is the
 * visitor. X-Forwarded-For is never read here.
 *
 * Falls back to `req.ip` when X-Real-IP is missing or not a valid IP.
 */
export type ClientIpSource = { ip?: string; headers?: Record<string, unknown> };

const MAX_IP_LENGTH = 128;

export function clientIp(req: ClientIpSource): string | null {
  const raw = req.headers?.['x-real-ip'];
  const realIp = Array.isArray(raw) ? raw[0] : raw;
  if (typeof realIp === 'string') {
    const candidate = realIp.trim();
    if (candidate && isIP(candidate)) return candidate.slice(0, MAX_IP_LENGTH);
  }
  const ip = typeof req.ip === 'string' ? req.ip.trim() : '';
  return ip ? ip.slice(0, MAX_IP_LENGTH) : null;
}

/** Eight 16-bit groups of an IPv6 address, or null when it does not parse. */
function ipv6Groups(address: string): number[] | null {
  let ip = address.split('%')[0] ?? '';
  // Trailing dotted IPv4 (e.g. ::ffff:1.2.3.4) becomes two hex groups.
  const dotted = ip.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2]!.split('.').map(Number);
    ip = `${dotted[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const parts = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const groups = parts.map((p) => (/^[0-9a-f]{1,4}$/i.test(p) ? parseInt(p, 16) : NaN));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

/**
 * Rate-limit bucket for a visitor. IPv4 (including IPv4-mapped IPv6) keys on
 * the full address. IPv6 keys on the /56 prefix, since one subscriber is
 * usually handed a whole /56 or /64 and could otherwise rotate addresses to
 * dodge a per-address limit. Same rule as express-rate-limit v8's
 * ipKeyGenerator, which the installed v7 does not ship.
 */
export function rateLimitKey(req: ClientIpSource): string {
  const ip = clientIp(req);
  if (!ip) return 'unknown';
  if (isIP(ip) === 4) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
  }
  const prefix = [groups[0]!, groups[1]!, groups[2]!, groups[3]! & 0xff00].map((g) =>
    g.toString(16),
  );
  return `${prefix.join(':')}::/56`;
}

/** keyGenerator for every express-rate-limit limiter. */
export function clientIpKeyGenerator(req: Request): string {
  return rateLimitKey(req as unknown as ClientIpSource);
}
