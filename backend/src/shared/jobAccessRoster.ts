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
 */

export type JobAccessKind = 'homeowner' | 'field_capture';

export type JobAccessPerson = {
  id: string;
  kind: JobAccessKind;
  name: string | null;
  email: string | null;
  accessType: string;
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
  role: string | null;
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
};

export type RosterProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
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
): { name: string | null; email: string | null } {
  if (!userId) return { name: null, email: null };
  const p = profiles.get(userId);
  if (!p) return { name: null, email: null };
  const name = p.full_name?.trim() || null;
  const email = p.email?.trim() || null;
  return { name: name || email, email };
}

function partyAccessType(party: RosterPartyRow): string {
  const trade = party.trade?.trim();
  if (trade) return trade;
  switch (party.role) {
    case 'general_contractor':
      return 'General contractor';
    case 'owner':
      return 'Owner';
    case 'adjuster':
      return 'Adjuster';
    case 'subcontractor':
      return 'Subcontractor';
    default:
      return 'Field Capture';
  }
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

    people.push({
      id: `share:${share.id}`,
      kind: 'homeowner',
      name: share.label?.trim() || email,
      email,
      accessType: 'Homeowner',
      grantedByName: granter.name,
      grantedByEmail: granter.email,
      grantedAt: share.created_at,
      lastAccessedAt,
      state: grant ? 'claimed' : state,
    });
  }

  // Grants whose share was deleted / never linked still count as access.
  for (const grant of input.grants) {
    if (grant.share_id && claimedShareIds.has(grant.share_id)) continue;
    const email = normEmail(grant.recipient_email);
    if (email && seenEmails.has(email)) continue;
    if (email) seenEmails.add(email);

    const user = profileLabel(profiles, grant.user_id);
    people.push({
      id: `grant:${grant.id}`,
      kind: 'homeowner',
      name: user.name || email,
      email: email || user.email,
      accessType: 'Homeowner',
      grantedByName: null,
      grantedByEmail: null,
      grantedAt: grant.created_at,
      lastAccessedAt: grant.last_accessed_at,
      state: 'claimed',
    });
  }

  for (const party of input.parties) {
    if (party.revoked_at) continue;
    const email = normEmail(party.email) || null;
    const granter = profileLabel(profiles, party.created_by);
    const name =
      party.contact_name?.trim() ||
      party.company?.trim() ||
      email ||
      'Crew';

    people.push({
      id: `party:${party.id}`,
      kind: 'field_capture',
      name,
      email,
      accessType: partyAccessType(party),
      grantedByName: granter.name,
      grantedByEmail: granter.email,
      grantedAt: party.invited_at ?? party.created_at,
      lastAccessedAt: party.last_seen_at,
      state: 'live',
    });
  }

  people.sort((a, b) => {
    const aT = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0;
    const bT = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0;
    if (aT !== bT) return bT - aT;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return people;
}
