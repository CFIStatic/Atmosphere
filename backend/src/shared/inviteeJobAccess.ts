/**
 * Capture-invite access: one email, only the jobs that were sent to it.
 *
 * Party tokens still open that one job file / what-to-film. Recording
 * requires an Atmosphere account whose email matches the invited party.
 * Listing never walks an org's crm_jobs — only job_parties rows for
 * this address.
 */

import type { User } from '@supabase/supabase-js';
import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import type { PartyRow } from '../lib/scopedAdmin.js';
import { authPhoneToE164, normalizePhoneE164 } from '../auth/phoneAuth.js';

export function normalizeInviteEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function inviteeEmailsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeInviteEmail(left);
  const b = normalizeInviteEmail(right);
  return Boolean(a && a === b);
}

/** Live party rows emailed to this address — never another recipient, never org-wide. */
export function partiesInvitedToEmail<
  T extends { email?: string | null; revoked_at?: string | null },
>(parties: T[], email: string | null | undefined): T[] {
  const want = normalizeInviteEmail(email);
  if (!want) return [];
  return parties.filter((party) => !party.revoked_at && inviteeEmailsMatch(party.email, want));
}

export function inviteeCanOpenJob(
  invitedJobIds: readonly string[],
  jobId: string | null | undefined,
): boolean {
  if (!jobId) return false;
  return invitedJobIds.includes(jobId);
}

export function assertInviteeMayRecord(
  party: Pick<PartyRow, 'email'> & { email?: string | null },
  userEmail: string | null | undefined,
): void {
  const user = normalizeInviteEmail(userEmail);
  if (!user) {
    throw new HttpError(401, 'Sign in or create an account to record.', 'account_required');
  }
  const invited = normalizeInviteEmail(party.email);
  if (invited && invited !== user) {
    throw new HttpError(403, `Sign in as ${invited} to record this job.`, 'invite_email_mismatch');
  }
}

export function assertInviteeAccount(req: Request, party: Pick<PartyRow, 'email'>): void {
  if (!req.user) {
    throw new HttpError(401, 'Sign in or create an account to record.', 'account_required');
  }
  assertInviteeMayRecord(party, req.user.email);
}

/**
 * Attach every live party invite for this email to a field identity.
 * Does not create org_members or consume Field Capture seats.
 */
export async function claimInvitedPartiesForUser(
  db: SupabaseClient,
  user: Pick<User, 'id' | 'email'> & { phone?: string | null },
): Promise<{ identityId: string; partyIds: string[] }> {
  const email = normalizeInviteEmail(user.email);
  const phone = authPhoneToE164(user.phone);
  if (!email && !phone) {
    throw new HttpError(400, 'Your account needs an email or phone number to claim invites.', 'contact_required');
  }

  // Email stays the primary identity when present; phone-only accounts use sms.
  const channel = email ? 'email' : 'sms';
  const address = email || (phone as string);
  const { data: identity, error: identityError } = await db
    .from('field_identities')
    .upsert(
      {
        channel,
        address,
        display_name: address,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'channel,address' },
    )
    .select('id')
    .single();
  if (identityError || !identity) {
    throw new HttpError(500, 'Could not attach this invite to your account.', 'identity_failed');
  }

  type Party = { id: string; org_id: string; email?: string | null; phone?: string | null; revoked_at?: string | null };
  const mine: Party[] = [];
  if (email) {
    const { data: parties, error: partyError } = await db
      .from('job_parties')
      .select('id, org_id, email, revoked_at')
      .eq('email', email)
      .is('revoked_at', null);
    if (partyError) {
      throw new HttpError(500, 'Could not load invites for this email.', 'invite_lookup_failed');
    }
    mine.push(...partiesInvitedToEmail((parties ?? []) as Party[], email));
  }
  if (phone) {
    const { data: parties, error: partyError } = await db
      .from('job_parties')
      .select('id, org_id, email, phone, revoked_at')
      .eq('phone', phone)
      .is('revoked_at', null);
    if (partyError) {
      throw new HttpError(500, 'Could not load invites for this number.', 'invite_lookup_failed');
    }
    for (const party of partiesInvitedToPhone((parties ?? []) as Party[], phone)) {
      if (!mine.some((m) => m.id === party.id)) mine.push(party);
    }
  }

  for (const party of mine) {
    const { error } = await db.from('job_party_claims').upsert(
      {
        org_id: party.org_id,
        party_id: party.id,
        identity_id: (identity as { id: string }).id,
      },
      { onConflict: 'party_id' },
    );
    if (error) {
      throw new HttpError(500, 'Could not attach this job.', 'claim_failed');
    }
  }

  return {
    identityId: (identity as { id: string }).id,
    partyIds: mine.map((party) => party.id),
  };
}

/** Live party rows texted to this number (E.164). Phone-only parties only. */
export function partiesInvitedToPhone<
  T extends { email?: string | null; phone?: string | null; revoked_at?: string | null },
>(parties: T[], phone: string | null | undefined): T[] {
  const want = normalizePhoneE164(phone);
  if (!want) return [];
  return parties.filter(
    (party) => !party.revoked_at && !normalizeInviteEmail(party.email) && normalizePhoneE164(party.phone) === want,
  );
}

/**
 * The live invite on one job for this email — the party a signed-in sub files
 * their videos under, so the job file still shows them only what they recorded.
 * Oldest invite first, so every film lands on the same party.
 */
export function invitedPartyForJob<
  T extends {
    job_id: string;
    email?: string | null;
    revoked_at?: string | null;
    created_at?: string | null;
  },
>(parties: T[], jobId: string | null | undefined, email: string | null | undefined): T | null {
  if (!jobId) return null;
  const mine = partiesInvitedToEmail(
    parties.filter((party) => party.job_id === jobId),
    email,
  );
  if (!mine.length) return null;
  return [...mine].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  )[0];
}

/**
 * Jobs that really were shared with this person by another company.
 *
 * A job in an org the person belongs to is their own job, never "shared",
 * even when a job_parties row carries their email (Field Capture adds a
 * general_contractor row for the filming GC, and a GC can invite their own
 * email as a sub). A job deleted from its org's library (tombstoned) is
 * gone for everyone, so it is never listed.
 */
export function sharedJobsOnly<J extends { id: string; org_id: string }>(
  jobs: J[],
  memberOrgIds: Iterable<string>,
  tombstonedByOrg: Map<string, Set<string>>,
): J[] {
  const mine = new Set(memberOrgIds);
  return jobs.filter((j) => !mine.has(j.org_id) && !tombstonedByOrg.get(j.org_id)?.has(j.id));
}

/**
 * Field Capture Today for someone with their own workspace: their jobs first,
 * then jobs other contractors shared with them. A job already on their own
 * list is never repeated.
 */
export function mergeSharedTodayJobs<A extends { id: string }, B extends { id: string }>(
  own: A[],
  shared: B[],
): Array<A | B> {
  const seen = new Set(own.map((job) => job.id));
  const extra = shared.filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
  return [...own, ...extra];
}
