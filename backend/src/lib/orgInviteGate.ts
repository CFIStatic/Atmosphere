import { createAdminClient } from './supabase.js';
import { HttpError } from './errors.js';
import { toOrgProductRole, type OrgProductRole } from './productRoles.js';

/**
 * Org seats after the first Global Admin are invite-only.
 *
 * Public signup creates the company (bill payer). Everyone else needs a
 * pending org_invites row for their email before a join code works — knowing
 * the code alone is not enough.
 */

export type PendingOrgInvite = {
  orgId: string;
  role: OrgProductRole;
  email: string;
};

export async function requirePendingOrgInvite(input: {
  joinCode: string;
  email: string | null | undefined;
}): Promise<PendingOrgInvite> {
  const email = input.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    throw new HttpError(
      403,
      'Ask your Global Admin to invite this email, then create the account with that address.',
      'invite_required',
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(
      503,
      'Invites cannot be checked until the server has a service role key.',
      'admin_unavailable',
    );
  }

  const code = input.joinCode.trim().toUpperCase();
  const { data: org, error: orgError } = await admin
    .from('orgs')
    .select('id')
    .eq('join_code', code)
    .maybeSingle();
  if (orgError) throw new HttpError(500, orgError.message, 'org_lookup_failed');
  if (!org?.id) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }

  const { data: invite, error: inviteError } = await admin
    .from('org_invites')
    .select('id, role, email')
    .eq('org_id', org.id)
    .eq('status', 'pending')
    .eq('email', email)
    .maybeSingle();
  if (inviteError) throw new HttpError(500, inviteError.message, 'invite_lookup_failed');
  if (!invite) {
    throw new HttpError(
      403,
      'This email has not been invited yet. Ask your Global Admin to send an invite.',
      'invite_required',
    );
  }

  return {
    orgId: org.id as string,
    role: toOrgProductRole(String(invite.role)),
    email: String(invite.email),
  };
}
