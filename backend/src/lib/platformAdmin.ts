/**
 * Cross-org support data access for the internal /admin portal.
 *
 * Every function here expects the caller to already have passed
 * `requirePlatformStaff`. Reads and writes use the service role because RLS is
 * per-org and support must see every customer account.
 */

import type { Request } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createAdminClient, createUserClient } from './supabase.js';
import { HttpError } from './errors.js';
import { config } from '../config.js';

export type PlatformStaffScope = 'support' | 'admin' | 'ops';

const SCOPE_RANK: Record<PlatformStaffScope, number> = {
  support: 1,
  admin: 2,
  ops: 3,
};

export function platformScopeAtLeast(
  scope: PlatformStaffScope,
  min: PlatformStaffScope,
): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[min];
}

export interface PlatformAccess {
  scope: PlatformStaffScope | null;
  displayName: string | null;
}

export interface AdminOrgSummary {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  createdBy: string | null;
  contractorType: string | null;
  memberCount: number;
  planCode: string | null;
  billingStatus: string | null;
  seats: number | null;
  billingInterval: string | null;
}

export interface AdminOrgDetail extends AdminOrgSummary {
  members: AdminMember[];
  jobBriefCount: number;
  jobProofCount: number;
  inviteCount: number;
  stripeCustomerId: string | null;
}

export interface AdminMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  status: string;
  workType: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  memberships: Array<{
    orgId: string;
    orgName: string;
    role: string;
    status: string;
  }>;
  platformScope: PlatformStaffScope | null;
}

export interface AuditEntry {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  orgId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

/** Tables staff may browse from the Database tab. Keep this curated. */
export const BROWSABLE_TABLES = [
  'orgs',
  'profiles',
  'org_members',
  'org_billing',
  'org_invites',
  'job_briefs',
  'job_proofs',
  'job_parties',
  'analytics_staff',
  'platform_staff',
  'platform_admin_audit',
] as const;

export type BrowsableTable = (typeof BROWSABLE_TABLES)[number];

export function requireAdminClient(): SupabaseClient {
  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(
      503,
      'Support portal requires SUPABASE_SERVICE_ROLE_KEY on the backend.',
      'service_role_required',
    );
  }
  return admin;
}

export async function getPlatformAccess(accessToken: string): Promise<PlatformAccess> {
  const supabase = createUserClient(accessToken);
  const { data, error } = await supabase.rpc('platform_admin_whoami');
  if (error) {
    // Migration not applied yet — treat as no access rather than 500.
    if (/function .*platform_admin_whoami/i.test(error.message) || error.code === '42883') {
      return { scope: null, displayName: null };
    }
    throw new HttpError(500, error.message, 'platform_access_failed');
  }
  const row = (data ?? {}) as { scope?: string | null; display_name?: string | null };
  const scope = row.scope as PlatformStaffScope | null | undefined;
  return {
    scope: scope && scope in SCOPE_RANK ? scope : null,
    displayName: row.display_name ?? null,
  };
}

export async function writeAudit(
  admin: SupabaseClient,
  req: Request,
  entry: {
    action: string;
    targetType?: string;
    targetId?: string;
    orgId?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const actor = req.user;
  await admin.from('platform_admin_audit').insert({
    actor_user_id: actor?.id,
    actor_email: actor?.email ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    org_id: entry.orgId ?? null,
    detail: entry.detail ?? {},
    ip: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  });
}

export async function listOrgs(
  admin: SupabaseClient,
  opts: { q?: string; limit?: number; offset?: number },
): Promise<{ orgs: AdminOrgSummary[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.q?.trim();

  let query = admin
    .from('orgs')
    .select('id, name, join_code, created_at, created_by, contractor_type', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    // ilike on name; exact uuid match when the query looks like one.
    if (/^[0-9a-f-]{36}$/i.test(q)) {
      query = query.eq('id', q);
    } else {
      query = query.ilike('name', `%${q}%`);
    }
  }

  const { data: orgs, error, count } = await query;
  if (error) throw new HttpError(500, error.message, 'orgs_list_failed');

  const orgIds = (orgs ?? []).map((o) => o.id as string);
  const [membersByOrg, billingByOrg] = await Promise.all([
    countMembers(admin, orgIds),
    loadBilling(admin, orgIds),
  ]);

  return {
    total: count ?? 0,
    orgs: (orgs ?? []).map((o) => {
      const billing = billingByOrg.get(o.id as string);
      return {
        id: o.id as string,
        name: o.name as string,
        joinCode: o.join_code as string,
        createdAt: o.created_at as string,
        createdBy: (o.created_by as string) ?? null,
        contractorType: (o.contractor_type as string) ?? null,
        memberCount: membersByOrg.get(o.id as string) ?? 0,
        planCode: billing?.plan_code ?? null,
        billingStatus: billing?.status ?? null,
        seats: billing?.seats ?? null,
        billingInterval: billing?.billing_interval ?? null,
      };
    }),
  };
}

async function countMembers(
  admin: SupabaseClient,
  orgIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (orgIds.length === 0) return map;
  const { data, error } = await admin.from('org_members').select('org_id').in('org_id', orgIds);
  if (error) throw new HttpError(500, error.message, 'members_count_failed');
  for (const row of data ?? []) {
    const id = row.org_id as string;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

async function loadBilling(
  admin: SupabaseClient,
  orgIds: string[],
): Promise<
  Map<
    string,
    {
      plan_code: string;
      status: string;
      seats: number;
      billing_interval: string;
      stripe_customer_id?: string | null;
    }
  >
> {
  const map = new Map();
  if (orgIds.length === 0) return map;
  const { data, error } = await admin
    .from('org_billing')
    .select('org_id, plan_code, status, seats, billing_interval, stripe_customer_id')
    .in('org_id', orgIds);
  if (error) {
    // stripe_customer_id may be absent on older schemas — retry without it.
    const retry = await admin
      .from('org_billing')
      .select('org_id, plan_code, status, seats, billing_interval')
      .in('org_id', orgIds);
    if (retry.error) throw new HttpError(500, retry.error.message, 'billing_load_failed');
    for (const row of retry.data ?? []) map.set(row.org_id, row);
    return map;
  }
  for (const row of data ?? []) map.set(row.org_id, row);
  return map;
}

export async function getOrgDetail(
  admin: SupabaseClient,
  orgId: string,
): Promise<AdminOrgDetail> {
  const { data: org, error } = await admin
    .from('orgs')
    .select('id, name, join_code, created_at, created_by, contractor_type')
    .eq('id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'org_load_failed');
  if (!org) throw new HttpError(404, 'Organization not found.', 'org_not_found');

  const [{ data: members, error: memErr }, billingMap, briefCount, proofCount, inviteCount] =
    await Promise.all([
      admin
        .from('org_members')
        .select('user_id, role, status, work_type, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true }),
      loadBilling(admin, [orgId]),
      countRows(admin, 'job_briefs', 'org_id', orgId),
      countRows(admin, 'job_proofs', 'org_id', orgId),
      countRows(admin, 'org_invites', 'org_id', orgId),
    ]);

  if (memErr) throw new HttpError(500, memErr.message, 'members_load_failed');

  const userIds = (members ?? []).map((m) => m.user_id as string);
  const profiles = await loadProfiles(admin, userIds);
  const authUsers = await loadAuthUsers(admin, userIds);
  const billing = billingMap.get(orgId);

  return {
    id: org.id as string,
    name: org.name as string,
    joinCode: org.join_code as string,
    createdAt: org.created_at as string,
    createdBy: (org.created_by as string) ?? null,
    contractorType: (org.contractor_type as string) ?? null,
    memberCount: members?.length ?? 0,
    planCode: billing?.plan_code ?? null,
    billingStatus: billing?.status ?? null,
    seats: billing?.seats ?? null,
    billingInterval: billing?.billing_interval ?? null,
    stripeCustomerId: billing?.stripe_customer_id ?? null,
    jobBriefCount: briefCount,
    jobProofCount: proofCount,
    inviteCount,
    members: (members ?? []).map((m) => {
      const uid = m.user_id as string;
      const profile = profiles.get(uid);
      const auth = authUsers.get(uid);
      return {
        userId: uid,
        email: profile?.email ?? auth?.email ?? null,
        fullName: profile?.full_name ?? null,
        role: m.role as string,
        status: m.status as string,
        workType: (m.work_type as string) ?? null,
        createdAt: m.created_at as string,
        lastSignInAt: auth?.last_sign_in_at ?? null,
        bannedUntil: auth?.banned_until ?? null,
      };
    }),
  };
}

async function countRows(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('id', { head: true, count: 'exact' })
    .eq(column, value);
  if (error) {
    // Table may not exist in older environments — treat as zero.
    return 0;
  }
  return count ?? 0;
}

async function loadProfiles(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, { email: string | null; full_name: string | null }>> {
  const map = new Map();
  if (userIds.length === 0) return map;
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .in('id', userIds);
  if (error) throw new HttpError(500, error.message, 'profiles_load_failed');
  for (const row of data ?? []) {
    map.set(row.id, { email: row.email ?? null, full_name: row.full_name ?? null });
  }
  return map;
}

type AuthUserLite = {
  email: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  created_at: string;
  email_confirmed_at: string | null;
};

async function loadAuthUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, AuthUserLite>> {
  const map = new Map<string, AuthUserLite>();
  // Admin getUserById is per-id; batch carefully for support pages (orgs are small).
  await Promise.all(
    userIds.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return;
      const u = data.user;
      map.set(id, {
        email: u.email ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at ?? null,
      });
    }),
  );
  return map;
}

export async function listUsers(
  admin: SupabaseClient,
  opts: { q?: string; limit?: number; page?: number },
): Promise<{ users: AdminUserSummary[]; total: number }> {
  const perPage = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim().toLowerCase();

  // Supabase Admin API has no email search — page and filter in memory for
  // support volumes. Cap scan so a typo doesn't walk the whole user table.
  const matched: User[] = [];
  let totalKnown = 0;
  const maxPages = q ? 20 : page;

  for (let p = 1; p <= maxPages; p += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage });
    if (error) throw new HttpError(500, error.message, 'users_list_failed');
    totalKnown = data.total ?? totalKnown;
    if (data.users.length === 0) break;

    if (!q) {
      if (p === page) matched.push(...data.users);
      if (p >= page) break;
      continue;
    }

    for (const u of data.users) {
      const email = u.email?.toLowerCase() ?? '';
      const name = String(u.user_metadata?.full_name ?? '').toLowerCase();
      if (email.includes(q) || name.includes(q) || u.id.toLowerCase() === q) {
        matched.push(u);
      }
    }
    if (matched.length >= perPage * 3) break;
  }

  const slice = q ? matched.slice(0, perPage) : matched;
  const userIds = slice.map((u) => u.id);
  const profiles = await loadProfiles(admin, userIds);
  const memberships = await loadMemberships(admin, userIds);
  const platformScopes = await loadPlatformScopes(admin, userIds);

  return {
    total: q ? matched.length : totalKnown,
    users: slice.map((u) => {
      const profile = profiles.get(u.id);
      return {
        id: u.id,
        email: u.email ?? profile?.email ?? null,
        fullName: profile?.full_name ?? (u.user_metadata?.full_name as string | undefined) ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        emailConfirmedAt: u.email_confirmed_at ?? null,
        bannedUntil: (u as { banned_until?: string | null }).banned_until ?? null,
        memberships: memberships.get(u.id) ?? [],
        platformScope: platformScopes.get(u.id) ?? null,
      };
    }),
  };
}

async function loadMemberships(
  admin: SupabaseClient,
  userIds: string[],
): Promise<
  Map<string, Array<{ orgId: string; orgName: string; role: string; status: string }>>
> {
  const map = new Map<
    string,
    Array<{ orgId: string; orgName: string; role: string; status: string }>
  >();
  if (userIds.length === 0) return map;

  const { data, error } = await admin
    .from('org_members')
    .select('user_id, role, status, org_id, orgs(id, name)')
    .in('user_id', userIds);
  if (error) throw new HttpError(500, error.message, 'memberships_load_failed');

  for (const row of data ?? []) {
    const uid = row.user_id as string;
    const org = row.orgs as unknown as { id: string; name: string } | null;
    const list = map.get(uid) ?? [];
    list.push({
      orgId: (row.org_id as string) ?? org?.id ?? '',
      orgName: org?.name ?? '(unknown)',
      role: row.role as string,
      status: row.status as string,
    });
    map.set(uid, list);
  }
  return map;
}

async function loadPlatformScopes(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, PlatformStaffScope>> {
  const map = new Map<string, PlatformStaffScope>();
  if (userIds.length === 0) return map;
  const { data, error } = await admin
    .from('platform_staff')
    .select('user_id, scope')
    .in('user_id', userIds);
  if (error) return map;
  for (const row of data ?? []) {
    map.set(row.user_id as string, row.scope as PlatformStaffScope);
  }
  return map;
}

export async function getUserDetail(
  admin: SupabaseClient,
  userId: string,
): Promise<AdminUserSummary> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new HttpError(404, 'User not found.', 'user_not_found');
  }
  const listed = await listUsers(admin, { q: userId, limit: 1, page: 1 });
  const found = listed.users[0];
  if (found) return found;

  const u = data.user;
  const profiles = await loadProfiles(admin, [userId]);
  const memberships = await loadMemberships(admin, [userId]);
  const platformScopes = await loadPlatformScopes(admin, [userId]);
  const profile = profiles.get(userId);
  return {
    id: u.id,
    email: u.email ?? profile?.email ?? null,
    fullName: profile?.full_name ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    bannedUntil: (u as { banned_until?: string | null }).banned_until ?? null,
    memberships: memberships.get(userId) ?? [],
    platformScope: platformScopes.get(userId) ?? null,
  };
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { createAnonClient } = await import('./supabase.js');
  const anon = createAnonClient();
  const { error } = await anon.auth.resetPasswordForEmail(email, {
    redirectTo: config.passwordResetRedirectUrl,
  });
  if (error) throw new HttpError(400, error.message, 'password_reset_failed');
}

export async function generateRecoveryLink(
  admin: SupabaseClient,
  email: string,
): Promise<{ actionLink: string }> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: config.passwordResetRedirectUrl },
  });
  if (error || !data.properties?.action_link) {
    throw new HttpError(
      400,
      error?.message ?? 'Could not generate recovery link.',
      'recovery_link_failed',
    );
  }
  return { actionLink: data.properties.action_link };
}

export async function setUserBanned(
  admin: SupabaseClient,
  userId: string,
  banned: boolean,
): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? '876000h' : 'none',
  } as { ban_duration: string });
  if (error) throw new HttpError(400, error.message, 'ban_update_failed');
}

export async function listAudit(
  admin: SupabaseClient,
  opts: { limit?: number; offset?: number; orgId?: string },
): Promise<{ entries: AuditEntry[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  let query = admin
    .from('platform_admin_audit')
    .select(
      'id, actor_user_id, actor_email, action, target_type, target_id, org_id, detail, ip, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.orgId) query = query.eq('org_id', opts.orgId);

  const { data, error, count } = await query;
  if (error) throw new HttpError(500, error.message, 'audit_list_failed');

  return {
    total: count ?? 0,
    entries: (data ?? []).map((r) => ({
      id: r.id as string,
      actorUserId: r.actor_user_id as string,
      actorEmail: (r.actor_email as string) ?? null,
      action: r.action as string,
      targetType: (r.target_type as string) ?? null,
      targetId: (r.target_id as string) ?? null,
      orgId: (r.org_id as string) ?? null,
      detail: (r.detail as Record<string, unknown>) ?? {},
      ip: (r.ip as string) ?? null,
      createdAt: r.created_at as string,
    })),
  };
}

export async function browseTable(
  admin: SupabaseClient,
  table: string,
  opts: { limit?: number; offset?: number; orgId?: string },
): Promise<{ table: string; rows: Record<string, unknown>[]; total: number }> {
  if (!(BROWSABLE_TABLES as readonly string[]).includes(table)) {
    throw new HttpError(400, `Table "${table}" is not browsable.`, 'table_not_allowed');
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  let query = admin
    .from(table)
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1);

  // Prefer newest-first when the table has created_at.
  query = query.order('created_at', { ascending: false, nullsFirst: false });

  if (opts.orgId) {
    // Only apply org filter when the column exists — PostgREST errors otherwise.
    if (
      [
        'org_members',
        'org_billing',
        'org_invites',
        'job_briefs',
        'job_proofs',
        'job_parties',
        'platform_admin_audit',
      ].includes(table)
    ) {
      query = query.eq('org_id', opts.orgId);
    } else if (table === 'orgs') {
      query = query.eq('id', opts.orgId);
    }
  }

  const { data, error, count } = await query;
  if (error) {
    // Retry without order if created_at is missing on the table.
    if (/created_at/i.test(error.message)) {
      let retry = admin.from(table).select('*', { count: 'exact' }).range(offset, offset + limit - 1);
      if (opts.orgId && table !== 'profiles' && table !== 'analytics_staff' && table !== 'platform_staff') {
        if (table === 'orgs') retry = retry.eq('id', opts.orgId);
        else if (
          [
            'org_members',
            'org_billing',
            'org_invites',
            'job_briefs',
            'job_proofs',
            'job_parties',
            'platform_admin_audit',
          ].includes(table)
        ) {
          retry = retry.eq('org_id', opts.orgId);
        }
      }
      const second = await retry;
      if (second.error) throw new HttpError(500, second.error.message, 'table_browse_failed');
      return {
        table,
        total: second.count ?? 0,
        rows: (second.data ?? []) as Record<string, unknown>[],
      };
    }
    throw new HttpError(500, error.message, 'table_browse_failed');
  }

  return {
    table,
    total: count ?? 0,
    rows: (data ?? []) as Record<string, unknown>[],
  };
}

export async function getInfrastructureSnapshot(admin: SupabaseClient | null): Promise<{
  time: string;
  environment: string;
  checks: Record<string, { ok: boolean; detail?: string; skipped?: boolean }>;
  counts: Record<string, number | null>;
  configFlags: Record<string, boolean>;
}> {
  const checks: Record<string, { ok: boolean; detail?: string; skipped?: boolean }> = {};

  // Reuse the same dependency probes as /api/ready, without importing the
  // router (keeps this module free of Express cycle risk).
  try {
    const { createAnonClient } = await import('./supabase.js');
    const anon = createAnonClient();
    const { error } = await anon.auth.getSession();
    checks.supabaseAuth = error ? { ok: false, detail: error.message } : { ok: true };
  } catch (err) {
    checks.supabaseAuth = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!admin) {
    checks.supabaseAdmin = {
      ok: false,
      skipped: !config.isProduction,
      detail: 'SUPABASE_SERVICE_ROLE_KEY unset',
    };
    checks.storage = {
      ok: false,
      skipped: !config.isProduction,
      detail: 'SUPABASE_SERVICE_ROLE_KEY unset',
    };
  } else {
    try {
      const { error } = await admin.from('orgs').select('id', { head: true, count: 'exact' }).limit(1);
      checks.supabaseAdmin = error ? { ok: false, detail: error.message } : { ok: true };
    } catch (err) {
      checks.supabaseAdmin = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      const { data, error } = await admin.storage.getBucket(config.media.hotBucket);
      if (error) checks.storage = { ok: false, detail: error.message };
      else if (!data) checks.storage = { ok: false, detail: `bucket ${config.media.hotBucket} missing` };
      else checks.storage = { ok: true, detail: config.media.hotBucket };
    } catch (err) {
      checks.storage = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  checks.config = {
    ok: Boolean(config.frontendOrigins.length && config.device.pepper),
    detail: config.isProduction ? 'production' : 'development',
  };

  const counts: Record<string, number | null> = {
    orgs: null,
    profiles: null,
    org_members: null,
    job_briefs: null,
    job_proofs: null,
    platform_staff: null,
  };

  if (admin) {
    await Promise.all(
      Object.keys(counts).map(async (table) => {
        const { count, error } = await admin
          .from(table)
          .select('*', { head: true, count: 'exact' });
        counts[table] = error ? null : count ?? 0;
      }),
    );
  }

  return {
    time: new Date().toISOString(),
    environment: config.isProduction ? 'production' : 'development',
    checks,
    counts,
    configFlags: {
      serviceRoleConfigured: Boolean(config.supabase.serviceRoleKey),
      stripeConfigured: Boolean(config.stripe?.secretKey),
      mediaBucket: Boolean(config.media?.hotBucket),
    },
  };
}
