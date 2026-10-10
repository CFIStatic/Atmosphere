/**
 * Read-only homeowner / viewer access to a job file.
 *
 * Progress-share recipients create an email+password account and claim the
 * share. They are not org_members, do not pay, and do not consume Field Capture seats.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import { requireOrgContext, type OrgContext } from '../lib/orgContext.js';
import { requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { normalizeServiceRoleInput } from './serviceRole.js';

export type JobProgressGrant = {
  orgId: string;
  jobId: string;
  shareId: string | null;
  recipientEmail: string;
};

/** Grants API / hub row — job title and vendor name, not just ids. */
export type JobProgressGrantView = JobProgressGrant & {
  orgName: string;
  jobTitle: string;
  status: string | null;
  path: string;
};

export function jobProgressPath(jobId: string): string {
  return `/job-progress?job=${encodeURIComponent(jobId)}`;
}

/** Merge grant rows with job + org lookups. Missing titles stay generic. */
export function presentJobProgressGrants(
  grants: JobProgressGrant[],
  jobs: Array<{ id: string; title?: string | null; status?: string | null }>,
  orgs: Array<{ id: string; name?: string | null }>,
): JobProgressGrantView[] {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const orgById = new Map(orgs.map((org) => [org.id, org]));
  return grants.map((grant) => {
    const job = jobById.get(grant.jobId);
    const org = orgById.get(grant.orgId);
    return {
      ...grant,
      orgName: org?.name?.trim() || 'Contractor',
      jobTitle: job?.title?.trim() || 'Job',
      status: job?.status ?? null,
      path: jobProgressPath(grant.jobId),
    };
  });
}

export async function enrichJobProgressGrants(
  admin: SupabaseClient,
  grants: JobProgressGrant[],
): Promise<JobProgressGrantView[]> {
  if (!grants.length) return [];
  const jobIds = [...new Set(grants.map((g) => g.jobId))];
  const orgIds = [...new Set(grants.map((g) => g.orgId))];
  const [{ data: jobs, error: jobsError }, { data: orgs, error: orgsError }] = await Promise.all([
    admin.from('crm_jobs').select('id, title, status').in('id', jobIds),
    admin.from('orgs').select('id, name').in('id', orgIds),
  ]);
  if (jobsError) throw new HttpError(500, jobsError.message, 'grants_jobs_failed');
  if (orgsError) throw new HttpError(500, orgsError.message, 'grants_orgs_failed');
  return presentJobProgressGrants(grants, (jobs ?? []) as any[], (orgs ?? []) as any[]);
}

export type SharedJobAccess =
  | (OrgContext & { access: 'org'; readOnly?: false })
  | {
      access: 'viewer';
      orgId: string;
      userId: string;
      role: 'viewer';
      productRole: 'employee';
      supabase: SupabaseClient;
      readOnly: true;
    };

function missingGrantsTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ''} ${error.code ?? ''}`;
  return /job_progress_grants|does not exist|schema cache/i.test(blob);
}

type GrantRow = {
  org_id: string;
  job_id: string;
  share_id: string | null;
  recipient_email: string;
  revoked_at?: string | null;
};

/**
 * A grant opens a job only while it is live: not revoked, its invite
 * (verifier_shares row) still exists, is not revoked, and is still addressed
 * to the grant's email — and, when we know who is signed in, that email is
 * theirs. Mirrors private.has_job_progress_grant in RLS.
 */
export function liveGrantRows<T extends GrantRow>(
  rows: T[],
  shares: Array<{ id: string; job_id: string; revoked_at: string | null; recipient_email: string | null }>,
  userEmail?: string | null,
): T[] {
  const shareById = new Map(shares.map((s) => [s.id, s]));
  const email = userEmail?.trim().toLowerCase() || null;
  return rows.filter((row) => {
    if (row.revoked_at) return false;
    if (!row.share_id) return false;
    const share = shareById.get(row.share_id);
    if (!share || share.revoked_at || share.job_id !== row.job_id) return false;
    const recipient = row.recipient_email?.trim().toLowerCase() || '';
    if ((share.recipient_email?.trim().toLowerCase() || '') !== recipient) return false;
    if (email && email !== recipient) return false;
    return true;
  });
}

async function selectGrantRows(
  admin: SupabaseClient,
  userId: string,
  jobId?: string,
): Promise<GrantRow[] | null> {
  const run = (columns: string) => {
    let q = admin.from('job_progress_grants').select(columns).eq('user_id', userId);
    if (jobId) q = q.eq('job_id', jobId);
    return q.order('created_at', { ascending: false });
  };
  let { data, error } = await run('org_id, job_id, share_id, recipient_email, revoked_at, access_kind');
  // Before 20261010210000 lands there is no revoked_at / access_kind.
  if (error && /revoked_at|access_kind|schema cache|column .* does not exist/i.test(error.message ?? '')) {
    ({ data, error } = await run('org_id, job_id, share_id, recipient_email'));
  }
  if (error) {
    if (missingGrantsTable(error)) return null;
    throw new HttpError(500, error.message, 'grants_lookup_failed');
  }
  // Homeowner grants only — subcontractor grants (future) open in their own org.
  return ((data ?? []) as any[]).filter((row) => !row.access_kind || row.access_kind === 'homeowner');
}

async function liveGrants(
  admin: SupabaseClient,
  rows: GrantRow[],
  userEmail?: string | null,
): Promise<JobProgressGrant[]> {
  const shareIds = [...new Set(rows.map((r) => r.share_id).filter((id): id is string => Boolean(id)))];
  let shares: Array<{ id: string; job_id: string; revoked_at: string | null; recipient_email: string | null }> = [];
  if (shareIds.length) {
    const { data, error } = await admin
      .from('verifier_shares')
      .select('id, job_id, revoked_at, recipient_email')
      .in('id', shareIds);
    if (error) throw new HttpError(500, error.message, 'grants_lookup_failed');
    shares = (data ?? []) as any[];
  }
  return liveGrantRows(rows, shares, userEmail).map((row) => ({
    orgId: row.org_id,
    jobId: row.job_id,
    shareId: row.share_id ?? null,
    recipientEmail: row.recipient_email,
  }));
}

/** Every live job this person was invited to, across contractor orgs, newest first. */
export async function listJobProgressGrants(
  admin: SupabaseClient,
  userId: string,
  userEmail?: string | null,
): Promise<JobProgressGrant[]> {
  const rows = await selectGrantRows(admin, userId);
  if (!rows) return [];
  return liveGrants(admin, rows, userEmail);
}

export async function findJobProgressGrant(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  userEmail?: string | null,
): Promise<JobProgressGrant | null> {
  const rows = await selectGrantRows(admin, userId, jobId);
  if (!rows) return null;
  const [grant] = await liveGrants(admin, rows, userEmail);
  return grant ?? null;
}

/**
 * Claim a live progress share for the signed-in user when their email matches.
 * Idempotent when already claimed by this user.
 */
export async function claimProgressShareForUser(input: {
  token: string;
  userId: string;
  userEmail: string | null | undefined;
}): Promise<{ orgId: string; jobId: string; path: string }> {
  const email = input.userEmail?.trim().toLowerCase() || '';
  if (!email) {
    throw new HttpError(400, 'Your account needs an email address to claim this job file.', 'email_required');
  }

  const admin = unscopedAdminOrNull() ?? requireAdmin();
  const { data: share, error } = await admin
    .from('verifier_shares')
    .select('id, org_id, job_id, recipient_email, expires_at, revoked_at, share_kind, access_token')
    .eq('access_token', input.token)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'share_lookup_failed');
  if (!share) throw new HttpError(404, 'This link does not exist.', 'not_found');
  if ((share as any).share_kind !== 'progress') {
    throw new HttpError(404, 'This link does not exist.', 'not_found');
  }
  if ((share as any).revoked_at) throw new HttpError(410, 'This link was revoked.', 'revoked');
  if ((share as any).expires_at && new Date((share as any).expires_at) < new Date()) {
    throw new HttpError(410, 'This link has expired.', 'expired');
  }

  const recipient = String((share as any).recipient_email ?? '').trim().toLowerCase();
  if (!recipient || recipient !== email) {
    throw new HttpError(
      403,
      `Sign in as ${recipient || 'the invited email'} to open this job file in your account.`,
      'email_mismatch',
    );
  }

  const homeowner = normalizeServiceRoleInput({ forceHomeowner: true });
  const row = {
    org_id: (share as any).org_id,
    job_id: (share as any).job_id,
    user_id: input.userId,
    share_id: (share as any).id,
    recipient_email: recipient,
    service_role: homeowner.service_role,
  };

  const { error: upsertError } = await admin.from('job_progress_grants').upsert(row, {
    onConflict: 'job_id,user_id',
  });
  if (upsertError) {
    if (missingGrantsTable(upsertError)) {
      throw new HttpError(
        503,
        'Homeowner job access is not available yet. Apply the job_progress_grants migration.',
        'grants_unavailable',
      );
    }
    // Retry without service_role if column not applied yet.
    if (/service_role|schema cache|column .* does not exist/i.test(upsertError.message ?? '')) {
      const { service_role: _sr, ...legacy } = row as any;
      const retry = await admin.from('job_progress_grants').upsert(legacy, {
        onConflict: 'job_id,user_id',
      });
      if (retry.error) throw new HttpError(400, retry.error.message, 'claim_failed');
    } else {
      throw new HttpError(400, upsertError.message, 'claim_failed');
    }
  }

  // Progress-share claim always labels the person as Homeowner for Analysis.
  await admin.from('profiles').upsert(
    {
      id: input.userId,
      email: email,
      service_role: 'homeowner',
      service_role_custom: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  const jobId = (share as any).job_id as string;
  return {
    orgId: (share as any).org_id as string,
    jobId,
    path: jobProgressPath(jobId),
  };
}


/** Stamp last_accessed_at when a grant viewer opens the job file. Best-effort. */
export async function touchJobProgressGrantAccess(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('job_progress_grants')
    .update({ last_accessed_at: now })
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .select('share_id')
    .maybeSingle();
  if (error) {
    if (missingGrantsTable(error)) return;
    // Column missing on an old DB — ignore; roster still works without stamps.
    if (/last_accessed_at|schema cache/i.test(`${error.message ?? ''} ${error.code ?? ''}`)) return;
    return;
  }
  const shareId = (data as any)?.share_id as string | null | undefined;
  if (!shareId) return;
  // Keep share last_opened_at in sync for the invite list; do not bump open_count
  // (that counts guest link exchanges, not every authenticated refresh).
  await admin.from('verifier_shares').update({ last_opened_at: now }).eq('id', shareId);
}

/** Org member, or a homeowner who claimed a progress share for this job. */
export async function resolveOrgOrViewerAccess(
  req: Request,
  jobId?: string,
): Promise<SharedJobAccess> {
  try {
    const ctx = await requireOrgContext(req);
    return { ...ctx, access: 'org' };
  } catch (err) {
    if (!(err instanceof HttpError) || err.code !== 'no_organization') throw err;
    const admin = unscopedAdminOrNull() ?? requireAdmin();
    if (jobId) {
      const grant = await findJobProgressGrant(admin, req.user!.id, jobId, req.user!.email);
      if (!grant) throw err;
      return {
        access: 'viewer',
        orgId: grant.orgId,
        userId: req.user!.id,
        role: 'viewer',
        productRole: 'employee',
        supabase: admin,
        readOnly: true,
      };
    }
    const grants = await listJobProgressGrants(admin, req.user!.id, req.user!.email);
    if (!grants.length) throw err;
    return {
      access: 'viewer',
      orgId: grants[0]!.orgId,
      userId: req.user!.id,
      role: 'viewer',
      productRole: 'employee',
      supabase: admin,
      readOnly: true,
    };
  }
}
