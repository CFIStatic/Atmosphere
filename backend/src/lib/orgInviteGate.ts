import type { SupabaseClient } from '@supabase/supabase-js';
import { adminForOrg, unscopedAdmin, unscopedAdminOrNull } from './scopedAdmin.js';
import { HttpError } from './errors.js';
import { toOrgProductRole, type OrgProductRole } from './productRoles.js';
import { authPhoneToE164 } from '../auth/phoneAuth.js';

/**
 * Org seats after the first Global Admin are invite-only.
 *
 * Public signup creates the company (bill payer). Everyone else needs a
 * pending org_invites row for their email. The org's join_code stays in the
 * database for the join_org RPC — callers never send or see it.
 */

export type PendingOrgInvite = {
  /** The org_invites row, so the join can mark it answered. */
  inviteId: string;
  orgId: string;
  role: OrgProductRole;
  email: string | null;
  phone: string | null;
  /** Advisory person service title from the invite. */
  serviceRole: string | null;
  serviceRoleCustom: string | null;
  /** Internal only — used to call join_org. Never returned to clients. */
  joinCode: string;
};

export async function requirePendingOrgInvite(input: {
  email: string | null | undefined;
  /** Verified auth phone (Supabase stores it without "+"). */
  phone?: string | null | undefined;
}): Promise<PendingOrgInvite> {
  const email = input.email?.trim().toLowerCase() ?? '';
  const hasEmail = Boolean(email && email.includes('@'));
  const phone = authPhoneToE164(input.phone);
  if (!hasEmail && !phone) {
    throw new HttpError(
      403,
      'Ask your Global Admin to invite this email, then create the account with that address.',
      'invite_required',
    );
  }

  const raw = unscopedAdmin();

  let query = raw
    .from('org_invites')
    .select('id, role, email, phone, org_id, service_role, service_role_custom')
    .eq('status', 'pending');
  query =
    hasEmail && phone
      ? query.or(`email.eq.${email},phone.eq.${phone}`)
      : hasEmail
        ? query.eq('email', email)
        : query.eq('phone', phone as string);
  const { data: invite, error: inviteError } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inviteError) throw new HttpError(500, inviteError.message, 'invite_lookup_failed');
  if (!invite?.org_id) {
    throw new HttpError(
      403,
      hasEmail
        ? 'This email has not been invited yet. Ask your Global Admin to send an invite.'
        : 'This number has not been invited yet. Ask your Global Admin to send an invite.',
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
    inviteId: String(invite.id),
    email: (invite as { email?: string | null }).email ?? null,
    phone: (invite as { phone?: string | null }).phone ?? null,
    serviceRole: (invite as { service_role?: string | null }).service_role ?? null,
    serviceRoleCustom: (invite as { service_role_custom?: string | null }).service_role_custom ?? null,
    joinCode,
  };
}

/**
 * Join the invited user to the invite's workspace.
 *
 * join_org is server-only (a user token holding a join code could otherwise
 * join any workspace without an invite), so the server calls join_org_as,
 * which runs join_org as this user. Keyless local runs and tests fall back to
 * the caller's own client.
 */
export async function joinOrgAsInvitee(
  userClient: SupabaseClient,
  userId: string,
  params: { p_code: string; p_role: string; p_work_type: string },
) {
  const admin = unscopedAdminOrNull();
  if (admin) return admin.rpc('join_org_as', { p_actor: userId, ...params });
  return userClient.rpc('join_org', params);
}
