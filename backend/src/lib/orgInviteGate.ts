import { adminForOrg, unscopedAdmin } from './scopedAdmin.js';
import { HttpError } from './errors.js';
import { toOrgProductRole, type OrgProductRole } from './productRoles.js';

/**
 * Org seats after the first Global Admin are invite-only.
 *
 * Public signup creates the company (bill payer). Everyone else needs a
 * pending org_invites row for their email. The org's join_code stays in the
 * database for the join_org RPC — callers never send or see it.
 */

export type PendingOrgInvite = {
  orgId: string;
  role: OrgProductRole;
  email: string;
  /** Internal only — used to call join_org. Never returned to clients. */
  joinCode: string;
};

export async function requirePendingOrgInvite(input: {
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

  const { data: invite, error: inviteError } = await raw
    .from('org_invites')
    .select('id, role, email, org_id')
    .eq('status', 'pending')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inviteError) throw new HttpError(500, inviteError.message, 'invite_lookup_failed');
  if (!invite?.org_id) {
    throw new HttpError(
      403,
      'This email has not been invited yet. Ask your Global Admin to send an invite.',
      'invite_required',
    );
  }

  const scoped = adminForOrg(invite.org_id as string, raw);
  const { data: org, error: orgError } = await scoped.raw
    .from('orgs')
    .select('id, join_code')
    .eq('id', scoped.scope.orgId)
    .maybeSingle();
  if (orgError) throw new HttpError(500, orgError.message, 'org_lookup_failed');
  const joinCode = String(org?.join_code ?? '').trim().toUpperCase();
  if (!org?.id || !joinCode) {
    throw new HttpError(400, 'Could not join that organization.', 'join_org_failed');
  }

  return {
    orgId: org.id as string,
    role: toOrgProductRole(String(invite.role)),
    email: String(invite.email),
    joinCode,
  };
}
