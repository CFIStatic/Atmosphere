/**
 * Who can open this job's progress / Field Capture — for the office roster.
 *
 * Sources (existing tables, not a parallel ACL):
 *   - verifier_shares (share_kind=progress): homeowner invites
 *   - job_progress_grants: claimed homeowner accounts
 *   - job_parties: Field Capture crew / subs
 *
 * lastAccessedAt prefers grant stamps for claimed accounts, then share opens,
 * then party last_seen_at. grantedBy comes from created_by → profiles.
 *
 * Service role titles (`role` / `displayLabel` / `serviceTitle`) feed Analysis
 * people-matching — see docs/user-service-role-titles.md.
 */

import {
  HOMEOWNER_SERVICE_ROLE,
  deriveServiceRole,
  formatPersonRoleLabel,
  type ServiceRoleLabel,
} from './serviceRole.js';

export type JobAccessKind = 'homeowner' | 'field_capture';

export type JobAccessPerson = {
  id: string;
  kind: JobAccessKind;
  name: string | null;
  email: string | null;
  /** Crew invited by mobile number only. */
  phone?: string | null;
  accessType: string;
  /** Curated service role slug — stable for speaker-identity. */
  role: string;
  /** Human service title (alias of serviceTitle). */
  displayLabel: string;
  /** Alias of displayLabel for speaker-identity OrgMemberHint.serviceTitle. */
  serviceTitle: string;
  /** "Alex — Electrician" or "Homeowner". */
  displayName: string;
  grantedByName: string | null;
  grantedByEmail: string | null;
  grantedAt: string | null;
  lastAccessedAt: string | null;
  state: 'live' | 'revoked' | 'expired' | 'claimed';
};

export type RosterShareRow = {
  id: string;
  label: string;
  recipient_email: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_opened_at: string | null;
  open_count: number | null;
  share_kind: string | null;
};

export type RosterPartyRow = {
  id: string;
  company: string;
  trade: string | null;
  contact_name: string | null;
  email: string | null;
  phone?: string | null;
  role: string | null;
  service_role?: string | null;
  service_role_custom?: string | null;
  created_by: string | null;
  created_at: string;
  invited_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type RosterGrantRow = {
  id: string;
  user_id: string;
  share_id: string | null;
  recipient_email: string;
  created_at: string;
  last_accessed_at: string | null;
  service_role?: string | null;
};

export type RosterProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  service_role?: string | null;
  service_role_custom?: string | null;
};

function normEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function shareState(row: Pick<RosterShareRow, 'revoked_at' | 'expires_at'>): 'live' | 'revoked' | 'expired' {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) < new Date()) return 'expired';
  return 'live';
}

function profileLabel(
  profiles: Map<string, RosterProfile>,
  userId: string | null | undefined,
): { name: string | null; email: string | null; profile: RosterProfile | null } {
  if (!userId) return { name: null, email: null, profile: null };
  const p = profiles.get(userId);
  if (!p) return { name: null, email: null, profile: null };
  const name = p.full_name?.trim() || null;
  const email = p.email?.trim() || null;
  return { name: name || email, email, profile: p };
}

function withServiceFields(
  base: Omit<JobAccessPerson, 'role' | 'displayLabel' | 'serviceTitle' | 'displayName' | 'accessType'>,
  label: ServiceRoleLabel,
  nameForFormat: string | null,
): JobAccessPerson {
  const displayName =
    formatPersonRoleLabel(nameForFormat, label) || label.displayLabel || nameForFormat || 'Someone';
  return {
    ...base,
    accessType: label.displayLabel,
    role: label.role,
    displayLabel: label.displayLabel,
    serviceTitle: label.displayLabel,
    displayName,
  };
}

function partyServiceLabel(party: RosterPartyRow): ServiceRoleLabel {
  return (
    deriveServiceRole({
      serviceRole: party.service_role,
      serviceRoleCustom: party.service_role_custom,
      trade: party.trade,
      partyRole: party.role,
      kind: 'job_party',
    }) || { role: 'crew', displayLabel: 'Crew' }
  );
}

/**
 * Build the roster list from already-fetched rows. Pure — easy to unit test.
 * Only people who currently have a path in (live share, active grant, or
 * non-revoked party). Revoked/expired shares drop out unless a grant remains.
 */
export function presentJobAccessRoster(input: {
  shares: RosterShareRow[];
  parties: RosterPartyRow[];
  grants: RosterGrantRow[];
  profiles: RosterProfile[];
}): JobAccessPerson[] {
  const profiles = new Map(input.profiles.map((p) => [p.id, p]));
  const grantsByShare = new Map(
    input.grants.filter((g) => g.share_id).map((g) => [g.share_id as string, g]),
  );
  const grantsByEmail = new Map<string, RosterGrantRow>();
  for (const g of input.grants) {
    const email = normEmail(g.recipient_email);
    if (!email) continue;
    const prev = grantsByEmail.get(email);
    if (!prev || laterIso(g.last_accessed_at, prev.last_accessed_at) === g.last_accessed_at) {
      grantsByEmail.set(email, g);
    }
  }

  const people: JobAccessPerson[] = [];
  const seenEmails = new Set<string>();
  const claimedShareIds = new Set<string>();

  for (const share of input.shares) {
    if ((share.share_kind ?? 'evidence') !== 'progress') continue;
    const state = shareState(share);
    const grant =
      grantsByShare.get(share.id) ??
      (normEmail(share.recipient_email) ? grantsByEmail.get(normEmail(share.recipient_email)) : undefined);

    // No current access path.
    if (state !== 'live' && !grant) continue;

    if (grant?.share_id) claimedShareIds.add(grant.share_id);
    const email = normEmail(share.recipient_email) || normEmail(grant?.recipient_email) || null;
    if (email) seenEmails.add(email);

    const granter = profileLabel(profiles, share.created_by);
    const lastAccessedAt = laterIso(grant?.last_accessed_at, share.last_opened_at);
    const name = share.label?.trim() || email;

    people.push(
      withServiceFields(
        {
          id: `share:${share.id}`,
          kind: 'homeowner',
          name,
          email,
          grantedByName: granter.name,
          grantedByEmail: granter.email,
          grantedAt: share.created_at,
          lastAccessedAt,
          state: grant ? 'claimed' : state,
        },
        HOMEOWNER_SERVICE_ROLE,
        name,
      ),
    );
  }

  // Grants whose share was deleted / never linked still count as access.
  for (const grant of input.grants) {
    if (grant.share_id && claimedShareIds.has(grant.share_id)) continue;
    const email = normEmail(grant.recipient_email);
    if (email && seenEmails.has(email)) continue;
    if (email) seenEmails.add(email);

    const user = profileLabel(profiles, grant.user_id);
    const name = user.name || email;

    people.push(
      withServiceFields(
        {
          id: `grant:${grant.id}`,
          kind: 'homeowner',
          name,
          email: email || user.email,
          grantedByName: null,
          grantedByEmail: null,
          grantedAt: grant.created_at,
          lastAccessedAt: grant.last_accessed_at,
          state: 'claimed',
        },
        HOMEOWNER_SERVICE_ROLE,
        name,
      ),
    );
  }

  for (const party of input.parties) {
    if (party.revoked_at) continue;
    const email = normEmail(party.email) || null;
    const granter = profileLabel(profiles, party.created_by);
    const name =
      party.contact_name?.trim() ||
      party.company?.trim() ||
      email ||
      party.phone?.trim() ||
      'Crew';
    const label = partyServiceLabel(party);

    people.push(
      withServiceFields(
        {
          id: `party:${party.id}`,
          kind: 'field_capture',
          name,
          email,
          phone: party.phone ?? null,
          grantedByName: granter.name,
          grantedByEmail: granter.email,
          grantedAt: party.invited_at ?? party.created_at,
          lastAccessedAt: party.last_seen_at,
          state: 'live',
        },
        label,
        party.contact_name?.trim() || null,
      ),
    );
  }

  const deduped = dedupeJobAccessPeople(people);

  deduped.sort((a, b) => {
    const aT = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0;
    const bT = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0;
    if (aT !== bT) return bT - aT;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return deduped;
}

/** Normalize a phone to digits (keep a leading + country code); '' if none. */
function normPhone(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Treat 10-digit US numbers and +1 numbers as the same person.
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * Identity key for one roster row: kind + normalized email (case-insensitive),
 * falling back to normalized phone. Rows with neither stay separate.
 */
export function jobAccessPersonKey(person: Pick<JobAccessPerson, 'kind' | 'email' | 'phone' | 'id'>): string {
  const email = normEmail(person.email);
  if (email) return `${person.kind}|e:${email}`;
  const phone = normPhone(person.phone);
  if (phone) return `${person.kind}|p:${phone}`;
  return `${person.kind}|id:${person.id}`;
}

const STATE_RANK: Record<JobAccessPerson['state'], number> = {
  claimed: 3,
  live: 2,
  expired: 1,
  revoked: 0,
};

function earlierIso(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() < new Date(b).getTime();
}

/**
 * One row per person per role. A job shared with the same homeowner (or the
 * same crew member invited) several times shows once:
 *   - lastAccessedAt: the most recent across their rows
 *   - state/badge: the strongest (claimed account > live invite > expired)
 *     and the row id follows it, so revoke targets the account row
 *   - grantedBy/grantedAt: whoever granted first (the original invite)
 * The trash button revokes every grant for that person (see revokeJobAccess).
 * DB rows are untouched — this is presentation only.
 */
export function dedupeJobAccessPeople(people: JobAccessPerson[]): JobAccessPerson[] {
  const byKey = new Map<string, JobAccessPerson>();
  const order: string[] = [];
  for (const person of people) {
    const key = jobAccessPersonKey(person);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...person });
      order.push(key);
      continue;
    }
    const stronger = STATE_RANK[person.state] > STATE_RANK[prev.state] ? person : prev;
    const firstGrant = earlierIso(person.grantedAt, prev.grantedAt) ? person : prev;
    const hasName = (p: JobAccessPerson) => Boolean(p.name && p.name !== p.email);
    const named = hasName(stronger) ? stronger : hasName(person) ? person : hasName(prev) ? prev : stronger;
    byKey.set(key, {
      ...stronger,
      name: named.name,
      displayName: named.displayName,
      email: stronger.email || prev.email || person.email,
      phone: stronger.phone ?? prev.phone ?? person.phone ?? null,
      grantedByName: firstGrant.grantedByName ?? prev.grantedByName ?? person.grantedByName,
      grantedByEmail: firstGrant.grantedByEmail ?? prev.grantedByEmail ?? person.grantedByEmail,
      grantedAt: firstGrant.grantedAt,
      lastAccessedAt: laterIso(prev.lastAccessedAt, person.lastAccessedAt),
    });
  }
  return order.map((k) => byKey.get(k) as JobAccessPerson);
}
