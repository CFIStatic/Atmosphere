/**
 * Scoped service-role helpers.
 *
 * `createAdminClient()` bypasses RLS. Call sites that forget `.eq('org_id', …)`
 * (or `.eq('job_id', …)`) can read or write another tenant's rows. These
 * helpers force the filters at the query builder so a new handler cannot
 * "just select *" across the project.
 *
 * Use `adminForPartyToken` for job-share / Field Capture guests.
 * Use `adminForJob` when the caller already resolved org + job (office JWT).
 * Use `adminForOrg` only for org-wide reads that have no job.
 *
 * `raw` is the unscoped client — needed for token lookup and storage signing.
 * Prefer the scoped `from()` for table access.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase.js';
import { HttpError } from './errors.js';

export type AdminScope = {
  orgId: string;
  jobId?: string;
  partyId?: string;
};

/** Filter builder after select / update / delete — the place `.eq` exists. */
export type FilterBuilder = {
  eq: (column: string, value: string) => FilterBuilder;
};

/**
 * Table handle that applies org/job/party filters on every read/write
 * except insert (inserts have no `.eq`; use `raw` and set the columns).
 */
export type ScopedTable = {
  select: (...args: unknown[]) => FilterBuilder;
  update: (...args: unknown[]) => FilterBuilder;
  delete: (...args: unknown[]) => FilterBuilder;
};

export type ScopedAdmin = {
  raw: SupabaseClient;
  scope: AdminScope;
  from: (table: string) => ScopedTable;
};

export function requireAdmin(): SupabaseClient {
  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(
      503,
      'Supabase is not configured on this server (SUPABASE_SERVICE_ROLE_KEY).',
      'no_admin',
    );
  }
  return admin;
}

/**
 * Apply org / job / party filters to a PostgREST builder.
 * Tables without those columns will fail at query time — that is intentional.
 */
export function scopeAdminQuery<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  scope: AdminScope,
): T {
  let next = query.eq('org_id', scope.orgId);
  if (scope.jobId) next = next.eq('job_id', scope.jobId);
  if (scope.partyId) next = next.eq('party_id', scope.partyId);
  return next;
}

function scopedFrom(admin: SupabaseClient, scope: AdminScope, table: string): ScopedTable {
  const q = admin.from(table) as unknown as {
    select: (...args: unknown[]) => FilterBuilder;
    update: (...args: unknown[]) => FilterBuilder;
    delete: (...args: unknown[]) => FilterBuilder;
  };
  return {
    select: (...args: unknown[]) => scopeAdminQuery(q.select(...args), scope),
    update: (...args: unknown[]) => scopeAdminQuery(q.update(...args), scope),
    delete: () => scopeAdminQuery(q.delete(), scope),
  };
}

export function adminForOrg(orgId: string, admin: SupabaseClient = requireAdmin()): ScopedAdmin {
  const scope: AdminScope = { orgId };
  return {
    raw: admin,
    scope,
    from(table: string) {
      return scopedFrom(admin, scope, table);
    },
  };
}

export function adminForJob(
  opts: { orgId: string; jobId: string; partyId?: string },
  admin: SupabaseClient = requireAdmin(),
): ScopedAdmin {
  const scope: AdminScope = {
    orgId: opts.orgId,
    jobId: opts.jobId,
    partyId: opts.partyId,
  };
  return {
    raw: admin,
    scope,
    from(table: string) {
      return scopedFrom(admin, scope, table);
    },
  };
}

export type PartyRow = {
  id: string;
  org_id: string;
  job_id: string;
  company: string | null;
  trade: string | null;
  contact_name: string | null;
  role: string | null;
  invited_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
};

const PARTY_TOKEN_SELECT =
  'id, org_id, job_id, company, trade, contact_name, role, invited_at, last_seen_at, revoked_at';

/**
 * Resolve a job-share / Field Capture token to one party, then return an
 * admin client that cannot query outside that party's org + job.
 */
export async function adminForPartyToken(token: string): Promise<{
  party: PartyRow;
  admin: ScopedAdmin;
}> {
  const trimmed = token.trim();
  if (!trimmed) throw new HttpError(404, 'This link is not valid.', 'bad_token');

  const raw = requireAdmin();
  const { data } = await raw
    .from('job_parties')
    .select(PARTY_TOKEN_SELECT)
    .eq('access_token', trimmed)
    .maybeSingle();

  if (!data) throw new HttpError(404, 'This link is not valid.', 'bad_token');
  const party = data as PartyRow;
  if (party.revoked_at) {
    throw new HttpError(403, 'Access to this job was withdrawn.', 'revoked');
  }

  await raw.from('job_parties').update({ last_seen_at: new Date().toISOString() }).eq('id', party.id);

  return {
    party,
    admin: adminForJob(
      { orgId: party.org_id, jobId: party.job_id, partyId: party.id },
      raw,
    ),
  };
}
