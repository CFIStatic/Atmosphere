import { adminForOrg, unscopedAdmin } from './scopedAdmin.js';
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

  const raw = unscopedAdmin();

  const code = input.joinCode.trim().toUpperCase();
  const { data: org, error: orgError } = await raw
    .from('orgs')
    .select('id')
    .eq('join_code', code)
    .maybeSingle();
  if (orgError) throw new HttpError(500, orgError.message, 'org_lookup_failed');
  if (!org?.id) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }

  const scoped = adminForOrg(org.id as string, raw);
  const { data: invite, error: inviteError } = await scoped.raw
    .from('org_invites')
    .select('id, role, email')
    .eq('org_id', scoped.scope.orgId)
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
