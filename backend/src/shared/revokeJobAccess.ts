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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Same normalization as the roster's phone key (digits, US +1 folded). */
export function normalizeAccessPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * The roster shows each crew member once even if they were invited several
 * times, so revoking them must revoke every live party row on this job that
 * matches their email (case-insensitive) or phone.
 */
export function matchingPartyIds(
  target: { id: string; email?: string | null; phone?: string | null },
  parties: Array<{ id: string; email?: string | null; phone?: string | null; revoked_at?: string | null }>,
): string[] {
  const email = (target.email ?? '').trim().toLowerCase();
  const phone = normalizeAccessPhone(target.phone);
  const ids = new Set<string>([target.id]);
  for (const p of parties) {
    if (p.revoked_at) continue;
    const pEmail = (p.email ?? '').trim().toLowerCase();
    if (email) {
      if (pEmail === email) ids.add(p.id);
      continue;
    }
    // Phone-only invite: match other phone-only rows with the same number.
    if (phone && !pEmail && normalizeAccessPhone(p.phone) === phone) ids.add(p.id);
  }
  return [...ids];
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

/**
 * Homeowner invites are matched to the account by email, so removing a
 * person removes every live invite on this job addressed to that email —
 * otherwise a resent invite would quietly link them back.
 */
async function revokeProgressSharesForEmail(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string,
  email: string | null | undefined,
): Promise<void> {
  const recipient = email?.trim().toLowerCase();
  if (!recipient) return;
  const { error } = await supabase
    .from('verifier_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('share_kind', 'progress')
    .is('revoked_at', null)
    .ilike('recipient_email', escapeLike(recipient));
  if (error) throw new HttpError(400, error.message, 'revoke_failed');
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
    q = q.ilike('recipient_email', escapeLike(input.recipientEmail.trim().toLowerCase()));
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
      .select('id, job_id, email, phone, revoked_at')
      .eq('org_id', input.orgId)
      .eq('id', ref.id)
      .maybeSingle();
    if (lookupError) throw new HttpError(500, lookupError.message, 'party_lookup_failed');
    if (!party || (party as any).job_id !== input.jobId) {
      throw new HttpError(404, 'No such Field Capture invite.', 'not_found');
    }
    const { data: siblings, error: siblingsError } = await input.supabase
      .from('job_parties')
      .select('id, email, phone, revoked_at')
      .eq('org_id', input.orgId)
      .eq('job_id', input.jobId)
      .is('revoked_at', null);
    if (siblingsError) throw new HttpError(500, siblingsError.message, 'party_lookup_failed');
    const ids = matchingPartyIds(party as any, (siblings ?? []) as any[]).filter(
      (id) => id !== ref.id || !(party as any).revoked_at,
    );
    if (ids.length) {
      const { error } = await input.supabase
        .from('job_parties')
        .update({ revoked_at: new Date().toISOString() })
        .eq('org_id', input.orgId)
        .eq('job_id', input.jobId)
        .in('id', ids);
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
    await revokeProgressSharesForEmail(input.supabase, input.orgId, input.jobId, recipientEmail);
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

  const grantEmail = ((grant as any).recipient_email as string | null) ?? null;
  // Same person may hold several grants on this job (shared more than once).
  if (grantEmail) {
    await deleteProgressGrants({
      admin: input.admin,
      orgId: input.orgId,
      jobId: input.jobId,
      recipientEmail: grantEmail,
    });
  }

  const shareId = (grant as any).share_id as string | null;
  if (shareId) {
    await revokeProgressShare(input.supabase, input.orgId, input.jobId, shareId);
  }
  await revokeProgressSharesForEmail(
    input.supabase,
    input.orgId,
    input.jobId,
    (grant as { recipient_email?: string | null }).recipient_email ?? null,
  );

  return { ok: true, kind: 'grant' };
}
