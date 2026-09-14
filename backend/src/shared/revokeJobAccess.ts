/**
 * Revoke one Who-has-access roster row (homeowner progress share/grant or
 * Field Capture party). Person ids match presentJobAccessRoster: share:, grant:, party:.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';

export type JobAccessPersonRef =
  | { kind: 'share'; id: string }
  | { kind: 'grant'; id: string }
  | { kind: 'party'; id: string };

const PERSON_ID =
  /^(share|grant|party):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseJobAccessPersonId(personId: string): JobAccessPersonRef {
  const m = PERSON_ID.exec(personId.trim());
  if (!m) {
    throw new HttpError(400, 'Unrecognized access roster id.', 'bad_person_id');
  }
  return { kind: m[1].toLowerCase() as JobAccessPersonRef['kind'], id: m[2] };
}

function missingGrantsTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ''} ${error.code ?? ''}`;
  return /job_progress_grants|does not exist|schema cache/i.test(blob);
}

async function revokeProgressShare(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string,
  shareId: string,
): Promise<{ recipientEmail: string | null }> {
  const { data: share, error: lookupError } = await supabase
    .from('verifier_shares')
    .select('id, recipient_email, revoked_at, share_kind, job_id')
    .eq('org_id', orgId)
    .eq('id', shareId)
    .maybeSingle();
  if (lookupError) throw new HttpError(500, lookupError.message, 'share_lookup_failed');
  if (!share || (share as any).job_id !== jobId) {
    throw new HttpError(404, 'No such invite.', 'not_found');
  }
  if ((share as any).share_kind && (share as any).share_kind !== 'progress') {
    throw new HttpError(400, 'Only job-progress invites can be revoked here.', 'wrong_share_kind');
  }
  if (!(share as any).revoked_at) {
    const { error } = await supabase
      .from('verifier_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('id', shareId);
    if (error) throw new HttpError(400, error.message, 'revoke_failed');
  }
  return { recipientEmail: ((share as any).recipient_email as string | null) ?? null };
}

async function deleteProgressGrants(input: {
  admin: SupabaseClient;
  orgId: string;
  jobId: string;
  shareId?: string | null;
  grantId?: string | null;
  recipientEmail?: string | null;
}): Promise<void> {
  let q = input.admin
    .from('job_progress_grants')
    .delete()
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId);
  if (input.grantId) {
    q = q.eq('id', input.grantId);
  } else if (input.shareId) {
    q = q.eq('share_id', input.shareId);
  } else if (input.recipientEmail) {
    q = q.eq('recipient_email', input.recipientEmail.trim().toLowerCase());
  } else {
    return;
  }
  const { error } = await q;
  if (error && !missingGrantsTable(error)) {
    throw new HttpError(400, error.message, 'grant_delete_failed');
  }
}

/**
 * Org-authorized revoke for one roster person. Uses the org-scoped client for
 * shares/parties and the service-role admin for job_progress_grants (RLS is
 * select-own only on that table).
 */
export async function revokeJobAccessPerson(input: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  orgId: string;
  jobId: string;
  personId: string;
}): Promise<{ ok: true; kind: JobAccessPersonRef['kind'] }> {
  const ref = parseJobAccessPersonId(input.personId);

  if (ref.kind === 'party') {
    const { data: party, error: lookupError } = await input.supabase
      .from('job_parties')
      .select('id, job_id, revoked_at')
      .eq('org_id', input.orgId)
      .eq('id', ref.id)
      .maybeSingle();
    if (lookupError) throw new HttpError(500, lookupError.message, 'party_lookup_failed');
    if (!party || (party as any).job_id !== input.jobId) {
      throw new HttpError(404, 'No such Field Capture invite.', 'not_found');
    }
    if (!(party as any).revoked_at) {
      const { error } = await input.supabase
        .from('job_parties')
        .update({ revoked_at: new Date().toISOString() })
        .eq('org_id', input.orgId)
        .eq('id', ref.id);
      if (error) throw new HttpError(400, error.message, 'revoke_failed');
    }
    return { ok: true, kind: 'party' };
  }

  if (ref.kind === 'share') {
    const { recipientEmail } = await revokeProgressShare(
      input.supabase,
      input.orgId,
      input.jobId,
      ref.id,
    );
    await deleteProgressGrants({
      admin: input.admin,
      orgId: input.orgId,
      jobId: input.jobId,
      shareId: ref.id,
    });
    // Grants whose share_id was cleared still count — drop by email on this job.
    if (recipientEmail) {
      await deleteProgressGrants({
        admin: input.admin,
        orgId: input.orgId,
        jobId: input.jobId,
        recipientEmail,
      });
    }
    return { ok: true, kind: 'share' };
  }

  // grant
  const { data: grant, error: grantError } = await input.admin
    .from('job_progress_grants')
    .select('id, share_id, recipient_email, job_id, org_id')
    .eq('id', ref.id)
    .maybeSingle();
  if (grantError) {
    if (missingGrantsTable(grantError)) {
      throw new HttpError(404, 'No such homeowner access.', 'not_found');
    }
    throw new HttpError(500, grantError.message, 'grant_lookup_failed');
  }
  if (
    !grant ||
    (grant as any).org_id !== input.orgId ||
    (grant as any).job_id !== input.jobId
  ) {
    throw new HttpError(404, 'No such homeowner access.', 'not_found');
  }

  await deleteProgressGrants({
    admin: input.admin,
    orgId: input.orgId,
    jobId: input.jobId,
    grantId: ref.id,
  });

  const shareId = (grant as any).share_id as string | null;
  if (shareId) {
    await revokeProgressShare(input.supabase, input.orgId, input.jobId, shareId);
  }

  return { ok: true, kind: 'grant' };
}
