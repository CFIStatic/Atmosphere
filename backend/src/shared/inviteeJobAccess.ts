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
  user: Pick<User, 'id' | 'email'>,
): Promise<{ identityId: string; partyIds: string[] }> {
  const email = normalizeInviteEmail(user.email);
  if (!email) {
    throw new HttpError(400, 'Your account needs an email address to claim invites.', 'email_required');
  }

  const { data: identity, error: identityError } = await db
    .from('field_identities')
    .upsert(
      {
        channel: 'email',
        address: email,
        display_name: email,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'channel,address' },
    )
    .select('id')
    .single();
  if (identityError || !identity) {
    throw new HttpError(500, 'Could not attach this invite to your account.', 'identity_failed');
  }

  const { data: parties, error: partyError } = await db
    .from('job_parties')
    .select('id, org_id, email, revoked_at')
    .eq('email', email)
    .is('revoked_at', null);
  if (partyError) {
    throw new HttpError(500, 'Could not load invites for this email.', 'invite_lookup_failed');
  }

  const mine = partiesInvitedToEmail((parties ?? []) as Array<{
    id: string;
    org_id: string;
    email?: string | null;
    revoked_at?: string | null;
  }>, email);

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
