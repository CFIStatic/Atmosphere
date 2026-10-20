export type CustomerStatus = 'paying' | 'trial' | 'comped' | 'unpaid' | 'none';

export interface CustomerPerson {
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  seatType: string | null;
  status: string | null;
  isOwner: boolean;
  joinedAt: string | null;
  lastSignInAt: string | null;
}

export interface CustomerOrg {
  orgId: string;
  name: string;
  ownerEmail: string | null;
  ownerName: string | null;
  planCode: string | null;
  billingStatus: string | null;
  status: CustomerStatus;
  stripeCustomerId: string | null;
  stripeLive: boolean | null;
  mrrCents: number;
  includedFcSeats: number;
  extraFcSeats: number;
  /** Field Capture seats in use (same rule as billing); null when not counted. */
  fcSeatsUsed: number | null;
  platformSeats: number;
  memberCount: number;
  jobsCount: number;
  createdAt: string | null;
  lastActivityAt: string | null;
  flags: string[];
  people: CustomerPerson[];
}

export interface CustomersResponse {
  generatedAt: string;
  customers: CustomerOrg[];
}

export interface SupportSessionCreated {
  sessionId: string;
  expiresAt: string;
  openUrl: string;
}

export type CustomerFilter = 'all' | 'paying' | 'trial' | 'comped' | 'test';
export type CustomerSort = 'name' | 'mrr' | 'members' | 'jobs' | 'created' | 'activity';

export function isTestOrg(org: CustomerOrg): boolean {
  return org.flags.length > 0;
}

/** Org name, owner, any member name or email, plan, or org id. */
export function filterCustomers(rows: CustomerOrg[], query: string, filter: CustomerFilter): CustomerOrg[] {
  const q = query.trim().toLowerCase();
  return rows.filter((org) => {
    if (filter === 'test' && !isTestOrg(org)) return false;
    if (filter !== 'all' && filter !== 'test' && org.status !== filter) return false;
    if (!q) return true;
    const hay = [org.name, org.orgId, org.ownerEmail, org.ownerName, org.planCode, ...org.people.flatMap((p) => [p.name, p.email])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function sortCustomers(rows: CustomerOrg[], sort: CustomerSort, dir: 'asc' | 'desc'): CustomerOrg[] {
  const key = (o: CustomerOrg): string | number => {
    switch (sort) {
      case 'name': return o.name.toLowerCase();
      case 'mrr': return o.mrrCents;
      case 'members': return o.memberCount;
      case 'jobs': return o.jobsCount;
      case 'created': return o.createdAt ?? '';
      case 'activity': return o.lastActivityAt ?? '';
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * sign || a.name.localeCompare(b.name);
  });
}

export function filterCounts(rows: CustomerOrg[]): Record<CustomerFilter, number> {
  return {
    all: rows.length,
    paying: rows.filter((r) => r.status === 'paying').length,
    trial: rows.filter((r) => r.status === 'trial').length,
    comped: rows.filter((r) => r.status === 'comped').length,
    test: rows.filter(isTestOrg).length,
  };
}

/** "work_verification" → "Work Verification"; "global_admin" → "Global admin". */
export function humanize(code: string | null | undefined, titleCase = false): string {
  if (!code) return '—';
  const words = code.replace(/[_-]+/g, ' ').trim().split(/\s+/);
  return words
    .map((w, i) => (titleCase || i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const SEAT_LABELS: Record<string, string> = { field_capture: 'Field Capture', platform: 'Platform', field: 'Field Capture' };

export function seatLabel(seatType: string | null | undefined): string | null {
  if (!seatType) return null;
  return SEAT_LABELS[seatType] ?? humanize(seatType);
}

/** Two letters for the monogram: "Ridge Roofing" → "RR", "acme" → "AC". */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** "Today", "Yesterday", "5 days ago", "3 weeks ago", "4 months ago". */
export function relativeDay(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const days = Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
