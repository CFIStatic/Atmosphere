/**
 * Customers directory for Atmosphere Analytics (internal scope only):
 * every workspace, its billing, and everyone with an account in it.
 * Nothing is dropped; test / staff / comped workspaces are marked.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CustomerStatus = 'paying' | 'trial' | 'comped' | 'unpaid' | 'none';

export type CustomerPerson = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  seatType: string | null;
  status: string | null;
  isOwner: boolean;
  joinedAt: string | null;
  lastSignInAt: string | null;
};

export type CustomerOrg = {
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
  platformSeats: number;
  memberCount: number;
  jobsCount: number;
  createdAt: string | null;
  lastActivityAt: string | null;
  flags: string[];
  people: CustomerPerson[];
};

const STAFF_DOMAINS = ['jettx.ai', 'atmosphereteam.com'];
const TEST_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com', 'mailinator.com'];

function domainOf(email: string | null | undefined): string {
  return String(email ?? '').toLowerCase().split('@')[1] ?? '';
}

export function classifyStatus(billing: any | null, excluded: boolean): CustomerStatus {
  const s = String(billing?.status ?? '').toLowerCase();
  if (s === 'trialing' || s === 'trial') return 'trial';
  if (s === 'active' && billing?.stripe_subscription_id && billing?.stripe_livemode !== false && Number(billing?.stripe_mrr_cents ?? 0) > 0) {
    return 'paying';
  }
  if (s === 'active' || excluded) return 'comped';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete' || s === 'canceled') return 'unpaid';
  return 'none';
}

export function orgFlags(org: any, people: CustomerPerson[]): string[] {
  const flags: string[] = [];
  if (org.exclude_from_analytics) flags.push(org.analytics_exclusion_reason ? `excluded: ${org.analytics_exclusion_reason}` : 'excluded');
  const domains = people.map((p) => domainOf(p.email)).filter(Boolean);
  if (domains.some((d) => STAFF_DOMAINS.includes(d))) flags.push('staff');
  if (domains.length > 0 && domains.every((d) => TEST_DOMAINS.includes(d))) flags.push('test');
  if (/\b(test|demo|sandbox)\b/i.test(String(org.name ?? ''))) flags.push('test-name');
  return flags;
}

function maxIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

/** Pure assembly, unit-tested. */
export function assembleCustomers(input: {
  orgs: any[];
  members: any[];
  profiles: any[];
  billing: any[];
  jobs: Array<{ org_id: string; updated_at?: string | null }>;
  lastSignIn: Map<string, string | null>;
}): CustomerOrg[] {
  const profileById = new Map(input.profiles.map((p) => [p.id, p]));
  const billingByOrg = new Map(input.billing.map((b) => [b.org_id, b]));
  const jobsByOrg = new Map<string, { count: number; last: string | null }>();
  for (const j of input.jobs) {
    const cur = jobsByOrg.get(j.org_id) ?? { count: 0, last: null };
    cur.count += 1;
    cur.last = maxIso(cur.last, j.updated_at ?? null);
    jobsByOrg.set(j.org_id, cur);
  }
  const membersByOrg = new Map<string, any[]>();
  for (const m of input.members) {
    const list = membersByOrg.get(m.org_id) ?? [];
    list.push(m);
    membersByOrg.set(m.org_id, list);
  }

  return input.orgs.map((org) => {
    const people: CustomerPerson[] = (membersByOrg.get(org.id) ?? []).map((m) => {
      const p = profileById.get(m.user_id);
      return {
        userId: m.user_id,
        name: p?.full_name ?? null,
        email: p?.email ?? null,
        role: m.role ?? null,
        seatType: m.seat_type ?? null,
        status: m.status ?? null,
        isOwner: m.user_id === org.created_by,
        joinedAt: m.created_at ?? null,
        lastSignInAt: input.lastSignIn.get(m.user_id) ?? null,
      };
    });
    people.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || String(a.name ?? a.email).localeCompare(String(b.name ?? b.email)));
    const owner = people.find((p) => p.isOwner) ?? null;
    const b = billingByOrg.get(org.id) ?? null;
    const jobs = jobsByOrg.get(org.id) ?? { count: 0, last: null };
    return {
      orgId: org.id,
      name: org.name ?? '(unnamed workspace)',
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.name ?? null,
      planCode: b?.atmosphere_plan_code ?? b?.plan_code ?? null,
      billingStatus: b?.status ?? null,
      status: classifyStatus(b, Boolean(org.exclude_from_analytics)),
      stripeCustomerId: b?.stripe_customer_id ?? null,
      stripeLive: b ? (b.stripe_livemode ?? null) : null,
      mrrCents: Number(b?.stripe_mrr_cents ?? 0),
      includedFcSeats: Number(b?.included_fc_seats ?? b?.seats ?? 0),
      extraFcSeats: Number(b?.extra_fc_seats ?? 0),
      platformSeats: Number(b?.platform_seats ?? 0),
      memberCount: people.length,
      jobsCount: jobs.count,
      createdAt: org.created_at ?? null,
      lastActivityAt: maxIso(jobs.last, ...people.map((p) => p.lastSignInAt)),
      flags: orgFlags(org, people),
      people,
    };
  });
}

async function allAuthSignIns(admin: SupabaseClient): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data.users) out.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 1000) break;
  }
  return out;
}

export async function loadCustomers(admin: SupabaseClient): Promise<CustomerOrg[]> {
  const [orgs, members, profiles, billing, jobs, lastSignIn] = await Promise.all([
    admin.from('orgs').select('id, name, created_by, created_at, exclude_from_analytics, analytics_exclusion_reason').limit(10000),
    admin.from('org_members').select('org_id, user_id, role, seat_type, status, created_at').limit(50000),
    admin.from('profiles').select('id, email, full_name').limit(50000),
    admin
      .from('org_billing')
      .select('org_id, plan_code, atmosphere_plan_code, status, seats, included_fc_seats, extra_fc_seats, platform_seats, stripe_customer_id, stripe_subscription_id, stripe_mrr_cents, stripe_livemode')
      .limit(10000),
    admin.from('crm_jobs').select('org_id, updated_at').is('deleted_at', null).limit(100000),
    allAuthSignIns(admin),
  ]);
  for (const r of [orgs, members, profiles, billing, jobs]) {
    if (r.error) throw new Error(r.error.message);
  }
  return assembleCustomers({
    orgs: orgs.data ?? [],
    members: members.data ?? [],
    profiles: profiles.data ?? [],
    billing: billing.data ?? [],
    jobs: (jobs.data ?? []) as any,
    lastSignIn,
  });
}
