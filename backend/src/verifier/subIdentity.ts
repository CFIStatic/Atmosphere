import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * A subcontractor, as themselves.
 *
 * The general contractor requires their subs to use this, so a drywall crew
 * working for six GCs collects six invitations across three jobs each. Every
 * one of those is a per-job token in a text message, which is right for the
 * first open — nobody signs up before they can read the scope — and useless
 * by the eighteenth.
 *
 * This module is the identity half: normalizing the channel a sub claims
 * with, minting and checking the code that proves they control it, and
 * grouping their claimed jobs by the general contractor who invited them.
 *
 * Everything here is pure or crypto-only. The rules that matter — what
 * counts as the same identity, when a code is dead, what the sub is allowed
 * to see — are decidable without a database, so they are tested that way.
 */

export type Channel = 'sms' | 'email';

export interface NormalizedContact {
  channel: Channel;
  /** E.164 for phones, lowercased and trimmed for email. */
  address: string;
}

/**
 * Turn what somebody typed into the key we store.
 *
 * Normalization is not cosmetic here: the uniqueness of an identity is a
 * unique index on (channel, address), so "(512) 555-0134" and "+15125550134"
 * must arrive as the same string or the same person becomes two people with
 * two disjoint job lists.
 *
 * Returns null rather than guessing. A contact we cannot normalize is one we
 * cannot send a code to, and inventing a plausible number would send a
 * stranger somebody else's job list.
 */
export function normalizeContact(raw: string): NormalizedContact | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  if (value.includes('@')) {
    const address = value.toLowerCase();
    // Deliberately strict and deliberately dumb: one @, something either
    // side, a dot in the domain. Anything cleverer starts rejecting real
    // addresses, and the code we send is the actual test of validity.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
    if (address.length > 254) return null;
    return { channel: 'email', address };
  }

  const digits = value.replace(/[^\d+]/g, '');
  const bare = digits.replace(/\D/g, '');
  if (!bare) return null;

  // North America, which is the whole market this ships to. An 11-digit
  // number starting 1 is the same number as its 10-digit form, and treating
  // them as different identities is the exact bug this function exists for.
  if (bare.length === 10) return { channel: 'sms', address: `+1${bare}` };
  if (bare.length === 11 && bare.startsWith('1')) return { channel: 'sms', address: `+${bare}` };
  // Anything else must have arrived already international, or we do not know
  // what country it is from and must not assume.
  if (digits.startsWith('+') && bare.length >= 8 && bare.length <= 15) return { channel: 'sms', address: `+${bare}` };
  return null;
}

/** How the address is shown back to the person who typed it. */
export function displayContact(contact: NormalizedContact): string {
  if (contact.channel === 'email') return contact.address;
  const bare = contact.address.replace(/\D/g, '');
  if (bare.length === 11 && bare.startsWith('1')) {
    const n = bare.slice(1);
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return contact.address;
}

/** The last few characters, for "we sent a code to ···0134". */
export function maskContact(contact: NormalizedContact): string {
  if (contact.channel === 'email') {
    const [user, domain] = contact.address.split('@');
    const head = user.slice(0, 1);
    return `${head}${'·'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
  }
  return `···${contact.address.slice(-4)}`;
}

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Six digits, uniformly drawn. Leading zeros are kept — 004821 is a code. */
export function mintCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export function mintSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface CodeRow {
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'consumed' | 'exhausted' | 'wrong' };

/**
 * Is this the code, and is it still alive?
 *
 * The order is the point. Expiry, consumption and attempt-exhaustion are all
 * checked before the digest comparison, so a dead code never reports "wrong"
 * — which would invite the holder to keep guessing at something that can no
 * longer work — and a live code with a bad guess never reports "expired",
 * which would hide a real attack behind a benign-looking message.
 */
export function checkCode(row: CodeRow, submitted: string, now: Date): CodeCheck {
  if (row.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: 'exhausted' };
  if (!hashesMatch(row.code_hash, hashCode(submitted))) return { ok: false, reason: 'wrong' };
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * The sub's own list
 * ------------------------------------------------------------------ */

export interface ClaimedJobRow {
  partyId: string;
  accessToken: string;
  orgId: string;
  orgName: string;
  jobId: string;
  jobTitle: string;
  jobNumber: number | null;
  address: string | null;
  scheduledStart: string | null;
  status: string | null;
  trade: string | null;
  /** Whether the GC has since withdrawn this link. */
  revoked: boolean;
}

export interface GcGroup {
  orgId: string;
  orgName: string;
  jobs: ClaimedJobRow[];
}

/**
 * Group the sub's jobs under the general contractor who invited them.
 *
 * A sub does not think "job 4471"; they think "the Anderson house, for
 * Brightwater". The GC is the organizing fact because it is the one that
 * decides who they call when something is wrong, and because two GCs can
 * absolutely have a job at the same address.
 *
 * Revoked links are dropped rather than shown greyed out. A withdrawn
 * invitation is not the sub's history to keep — it is the GC's — and leaving
 * it visible implies an access that no longer exists.
 *
 * Ordering is deliberate and total: soonest scheduled work first within a GC,
 * unscheduled last, ties broken by job title so the list does not reshuffle
 * itself between refreshes.
 */
export function groupByGeneralContractor(rows: ClaimedJobRow[]): GcGroup[] {
  const live = rows.filter((r) => !r.revoked);
  const byOrg = new Map<string, GcGroup>();

  for (const row of live) {
    let group = byOrg.get(row.orgId);
    if (!group) {
      group = { orgId: row.orgId, orgName: row.orgName, jobs: [] };
      byOrg.set(row.orgId, group);
    }
    group.jobs.push(row);
  }

  const startOf = (r: ClaimedJobRow) =>
    r.scheduledStart ? new Date(r.scheduledStart).getTime() : Number.POSITIVE_INFINITY;

  for (const group of byOrg.values()) {
    group.jobs.sort((a, b) => {
      const d = startOf(a) - startOf(b);
      if (d !== 0 && Number.isFinite(d)) return d;
      if (startOf(a) !== startOf(b)) return startOf(a) - startOf(b);
      return a.jobTitle.localeCompare(b.jobTitle);
    });
  }

  // GCs ordered by whoever the sub is due at soonest, so the list answers
  // "where am I going" without being read.
  return [...byOrg.values()].sort((a, b) => {
    const d = startOf(a.jobs[0]) - startOf(b.jobs[0]);
    if (d !== 0) return d;
    return a.orgName.localeCompare(b.orgName);
  });
}

/**
 * Today's work, flattened across every general contractor.
 *
 * The sub is standing somewhere at 7am. This is the answer to the only
 * question they have, and it deliberately ignores which GC the job belongs
 * to — the day does not organize itself by employer.
 */
export function dueToday(rows: ClaimedJobRow[], now: Date): ClaimedJobRow[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  return rows
    .filter((r) => !r.revoked && r.scheduledStart)
    .filter((r) => {
      const t = new Date(r.scheduledStart as string).getTime();
      return t >= startOfDay.getTime() && t < endOfDay.getTime();
    })
    .sort(
      (a, b) =>
        new Date(a.scheduledStart as string).getTime() - new Date(b.scheduledStart as string).getTime(),
    );
}
