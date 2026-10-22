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
import { partiesInvitedToEmail } from './inviteeJobAccess.js';
import { loadHomeownerPermissions, type HomeownerPermissions } from './homeownerPermissions.js';
import { loadHomeownerSharing, type HomeownerSharing } from './homeownerSharing.js';

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
      /**
       * Set for an invited subcontractor (job party): same job file, but only
       * the videos this party recorded. Null/absent for a homeowner, who sees
       * every recording.
       */
      partyId?: string | null;
      /**
       * Set for a homeowner (progress grant): what the contractor lets them
       * see and do on this job (job_homeowner_permissions, effective values).
       * Null/absent for a sub and for list-level access without a job.
       */
      homeownerPermissions?: HomeownerPermissions | null;
      /** Homeowner only: clips not shared yet (sharing delay / held). */
      homeownerSharing?: HomeownerSharing | null;
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
/**
 * Every live homeowner invite (Share > Homeowner) addressed to this email,
 * not yet claimed by this account. Pure so it can be tested without a DB.
 */
export function unclaimedSharesForEmail<
  S extends { id: string; job_id: string; recipient_email: string | null; revoked_at: string | null; expires_at?: string | null },
>(shares: S[], live: Array<{ job_id: string; share_id: string | null; revoked_at?: string | null }>, email: string, now = Date.now()): S[] {
  const want = email.trim().toLowerCase();
  if (!want) return [];
  const claimed = new Set(live.filter((g) => !g.revoked_at && g.share_id).map((g) => `${g.job_id}:${g.share_id}`));
  const seenJobs = new Set<string>();
  return shares.filter((s) => {
    if (s.revoked_at) return false;
    if (s.expires_at && new Date(s.expires_at).getTime() < now) return false;
    if ((s.recipient_email ?? '').trim().toLowerCase() !== want) return false;
    if (claimed.has(`${s.job_id}:${s.id}`) || seenJobs.has(s.job_id)) return false;
    seenJobs.add(s.job_id);
    return true;
  });
}

/**
 * The homeowner account is the email. Any job a contractor shares with that
 * email (now or years later) joins the account without clicking each invite
 * link: live invites to the signed-in email become grants, the same row the
 * link claim writes. Best-effort; the per-link claim still works.
 */
async function adoptSharesForEmail(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null | undefined,
  jobId?: string,
): Promise<void> {
  const email = userEmail?.trim().toLowerCase() || '';
  if (!email) return;
  try {
    let q = admin
      .from('verifier_shares')
      .select('id, org_id, job_id, recipient_email, revoked_at, expires_at')
      .eq('share_kind', 'progress')
      .is('revoked_at', null)
      .ilike('recipient_email', escapeLike(email))
      .order('created_at', { ascending: false })
      .limit(200);
    if (jobId) q = q.eq('job_id', jobId);
    const { data: shares, error } = await q;
    if (error || !shares?.length) return;
    let gq = admin.from('job_progress_grants').select('job_id, share_id, revoked_at').eq('user_id', userId);
    if (jobId) gq = gq.eq('job_id', jobId);
    const { data: grants, error: grantsError } = await gq;
    if (grantsError) return;
    type ShareRow = {
      id: string;
      org_id: string;
      job_id: string;
      recipient_email: string | null;
      revoked_at: string | null;
      expires_at: string | null;
    };
    type GrantPeek = { job_id: string; share_id: string | null; revoked_at: string | null };
    const todo = unclaimedSharesForEmail(shares as ShareRow[], (grants ?? []) as GrantPeek[], email);
    if (!todo.length) return;
    const homeowner = normalizeServiceRoleInput({ forceHomeowner: true });
    const rows = todo.map((s) => ({
      org_id: s.org_id,
      job_id: s.job_id,
      user_id: userId,
      share_id: s.id,
      recipient_email: email,
      service_role: homeowner.service_role,
      revoked_at: null,
    }));
    const { error: upsertError } = await admin.from('job_progress_grants').upsert(rows, { onConflict: 'job_id,user_id' });
    if (upsertError) console.warn('[grants] adopt by email failed:', upsertError.message);
  } catch (err) {
    console.warn('[grants] adopt by email failed:', err instanceof Error ? err.message : err);
  }
}

export async function listJobProgressGrants(
  admin: SupabaseClient,
  userId: string,
  userEmail?: string | null,
): Promise<JobProgressGrant[]> {
  await adoptSharesForEmail(admin, userId, userEmail);
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
  await adoptSharesForEmail(admin, userId, userEmail, jobId);
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

  // Progress-share claim labels the person as Homeowner for Analysis, unless
  // they have a work account: a contractor opening a shared job keeps their role.
  const { data: memberships, error: memberError } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', input.userId)
    .limit(1);
  const hasWorkAccount = Boolean(memberError) || (memberships ?? []).length > 0;
  if (!hasWorkAccount) await admin.from('profiles').upsert(
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

/**
 * A job that belongs to a different org than the caller's, which the caller
 * was invited to by a claimed progress share (email must still match). Null
 * for the caller's own jobs, unknown jobs, or no grant.
 */
export async function viewerGrantForForeignJob(
  req: Request,
  callerOrgId: string,
  jobId: string,
): Promise<JobProgressGrant | null> {
  const admin = unscopedAdminOrNull() ?? requireAdmin();
  const { data: job } = await admin.from('crm_jobs').select('org_id').eq('id', jobId).maybeSingle();
  const jobOrg = (job as { org_id?: string } | null)?.org_id;
  if (!jobOrg || jobOrg === callerOrgId) return null;
  return findJobProgressGrant(admin, req.user!.id, jobId, req.user!.email);
}

function viewerAccess(req: Request, orgId: string, partyId: string | null = null): SharedJobAccess {
  const admin = unscopedAdminOrNull() ?? requireAdmin();
  return {
    access: 'viewer',
    orgId,
    userId: req.user!.id,
    role: 'viewer',
    productRole: 'employee',
    supabase: admin,
    readOnly: true,
    partyId,
  } as SharedJobAccess;
}

/** The sub's party id when this access is an invited subcontractor, else null. */
/** A homeowner on one job: viewer access carrying the contractor's settings. */
async function homeownerAccess(req: Request, orgId: string, jobId: string): Promise<SharedJobAccess> {
  const admin = unscopedAdminOrNull() ?? requireAdmin();
  const [homeownerPermissions, homeownerSharing] = await Promise.all([
    loadHomeownerPermissions(admin, jobId),
    loadHomeownerSharing(admin, jobId),
  ]);
  return { ...viewerAccess(req, orgId), homeownerPermissions, homeownerSharing } as SharedJobAccess;
}

export function viewerPartyId(access: SharedJobAccess): string | null {
  return access.access === 'viewer' ? access.partyId ?? null : null;
}

/** An invited subcontractor opens only clips they recorded (404 otherwise). */
export function assertViewerMayOpenProof(
  access: SharedJobAccess,
  proof: { party_id?: string | null } | null | undefined,
): void {
  const partyId = viewerPartyId(access);
  if (partyId && proof?.party_id !== partyId) {
    throw new HttpError(404, 'No such video.', 'not_found');
  }
}

export type JobPartyView = { orgId: string; jobId: string; partyId: string };

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Jobs this person was invited to as a subcontractor or crew (Share >
 * Subcontractor or crew): live job_parties rows addressed to their email.
 * Signing in proves the email, the same proof the invite link carries.
 */
export async function listJobPartyViews(
  admin: SupabaseClient,
  userEmail: string | null | undefined,
  jobId?: string,
): Promise<JobPartyView[]> {
  const email = userEmail?.trim().toLowerCase() || '';
  if (!email) return [];
  let q = admin
    .from('job_parties')
    .select('id, org_id, job_id, email, revoked_at, created_at')
    .ilike('email', escapeLike(email))
    .is('revoked_at', null);
  if (jobId) q = q.eq('job_id', jobId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) return [];
  const rows = partiesInvitedToEmail((data ?? []) as any[], email);
  const seen = new Set<string>();
  const out: JobPartyView[] = [];
  for (const row of rows) {
    if (seen.has(row.job_id)) continue;
    seen.add(row.job_id);
    out.push({ orgId: row.org_id, jobId: row.job_id, partyId: row.id });
  }
  return out;
}

async function findJobPartyView(
  admin: SupabaseClient,
  userEmail: string | null | undefined,
  jobId: string,
): Promise<JobPartyView | null> {
  const [view] = await listJobPartyViews(admin, userEmail, jobId);
  return view ?? null;
}

/**
 * Org member, a homeowner who claimed a progress share for this job, or a
 * subcontractor invited to it (viewer scoped to their own videos). A
 * homeowner grant wins over a sub invite on the same job.
 */
export async function resolveOrgOrViewerAccess(
  req: Request,
  jobId?: string,
): Promise<SharedJobAccess> {
  try {
    const ctx = await requireOrgContext(req);
    if (jobId) {
      const admin = unscopedAdminOrNull() ?? requireAdmin();
      const { data: job } = await admin.from('crm_jobs').select('org_id').eq('id', jobId).maybeSingle();
      const jobOrg = (job as { org_id?: string } | null)?.org_id;
      if (jobOrg && jobOrg !== ctx.orgId) {
        // A contractor invited to another company's job opens it as a viewer.
        const grant = await findJobProgressGrant(admin, req.user!.id, jobId, req.user!.email);
        if (grant) return homeownerAccess(req, grant.orgId, jobId);
        const party = await findJobPartyView(admin, req.user!.email, jobId);
        if (party && party.orgId === jobOrg) return viewerAccess(req, party.orgId, party.partyId);
      }
    }
    return { ...ctx, access: 'org' };
  } catch (err) {
    if (!(err instanceof HttpError) || err.code !== 'no_organization') throw err;
    const admin = unscopedAdminOrNull() ?? requireAdmin();
    if (jobId) {
      const grant = await findJobProgressGrant(admin, req.user!.id, jobId, req.user!.email);
      if (grant) return homeownerAccess(req, grant.orgId, jobId);
      const party = await findJobPartyView(admin, req.user!.email, jobId);
      if (party) return viewerAccess(req, party.orgId, party.partyId);
      throw err;
    }
    const grants = await listJobProgressGrants(admin, req.user!.id, req.user!.email);
    if (grants.length) return viewerAccess(req, grants[0]!.orgId);
    throw err;
  }
}

/**
 * Who may open one clip: the clip's own org, or someone the clip's job was
 * shared with (viewer). Peeks the job with admin, then the normal job check.
 */
export async function resolveProofAccess(req: Request, proofId: string) {
  const admin = unscopedAdminOrNull();
  if (admin) {
    const { data: peek } = await admin.from('job_proofs').select('job_id').eq('id', proofId).maybeSingle();
    const jobId = (peek as { job_id?: string } | null)?.job_id;
    if (jobId) return resolveOrgOrViewerAccess(req, jobId);
  }
  return resolveOrgOrViewerAccess(req);
}
