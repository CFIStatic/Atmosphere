/**
 * Resolving a join code to a company name — for the QR / link landing.
 *
 * The invite section can now hand out the join code as a QR code or link
 * (`/signup?join=CODE`). The person scanning it deserves to see *who* they are
 * about to join before they create an account, so there is one unauthenticated
 * lookup: code in, org name out.
 *
 * That lookup discloses exactly one thing — the company name behind a code —
 * and only to somebody already holding the code, which is the join credential
 * itself. Still, an open endpoint invites guessing, so the format gate and the
 * throttle below exist to make scanning the code space pointless. Both are
 * pure and tested here, in the pattern of org/invites.ts.
 */

/** Same shape the signup form accepts. Anything else is not worth a query. */
const JOIN_CODE_RE = /^[A-Za-z0-9]{6,12}$/;

/**
 * The canonical form of a join code, or null when the input could never be
 * one. Codes are minted uppercase; people type them from phones, so case and
 * stray whitespace are forgiven here rather than at the database.
 */
export function normalizeJoinCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return JOIN_CODE_RE.test(code) ? code : null;
}

/**
 * A fixed-window counter, per key, for the anonymous lookup.
 *
 * Not a general rate limiter — a tripwire. A crew member scanning a QR code
 * makes one lookup; a scanner walking the code space makes thousands. The
 * window resets wholesale rather than sliding because the difference only
 * matters to the attacker.
 */
export class LookupThrottle {
  private counts = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record one attempt for `key` and say whether it is still within bounds. */
  allow(key: string, now: number): boolean {
    const entry = this.counts.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      // Housekeeping rides on the reset: a map that only ever grows would be
      // a slow leak fed by strangers' IP addresses.
      if (this.counts.size > 10_000) this.counts.clear();
      this.counts.set(key, { windowStart: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}
