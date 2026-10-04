/**
 * Self-service account deletion (App Store guideline 5.1.1(v)).
 *
 * Default policy — the product owner can change it:
 * - The person's login (Supabase auth user), personal profile, and org
 *   memberships are removed. Their saved voiceprint, device sign-in
 *   credentials, and profile photo go with them.
 * - Jobs, files, and videos belong to the company and stay with it.
 * - If the person is the only active admin of an org that still has other
 *   active members, deletion is blocked until someone else is made an admin.
 * - If the person is the only member of an org, the membership is removed
 *   and the company data is left in place.
 *
 * Many company tables point at `auth.users` / `profiles` without
 * `on delete set null` (for example `jobs.created_by`), so a hard delete
 * can fail for anyone who created work. In that case the profile is
 * scrubbed instead of deleted and the auth user is soft-deleted, which
 * Supabase Auth implements by wiping the email, phone, password, metadata,
 * identities, and every session. Either way the person can no longer sign
 * in and their personal details are gone.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isGlobalAdmin } from '../lib/productRoles.js';
import { HttpError } from '../lib/errors.js';
import { AVATAR_BUCKET } from '../lib/avatar.js';

export type AccountMembership = {
  orgId: string;
  orgName: string | null;
  role: string | null;
  status: string | null;
};

export type OrgMemberRow = {
  userId: string;
  role: string | null;
  status: string | null;
};

export type BlockedOrg = { orgId: string; orgName: string | null };

export type OrgOutcome = {
  orgId: string;
  orgName: string | null;
  /** True when the person was the org's only active member. */
  soleMember: boolean;
};

export type AccountDeletionPlan =
  | { ok: false; blocked: BlockedOrg[] }
  | { ok: true; orgs: OrgOutcome[] };

function isActive(status: string | null | undefined): boolean {
  return (status ?? 'active') === 'active';
}

/**
 * Pure decision step. `membersByOrg` holds every member row of each org the
 * person belongs to (including the person).
 */
export function planAccountDeletion(
  userId: string,
  memberships: AccountMembership[],
  membersByOrg: Map<string, OrgMemberRow[]>,
): AccountDeletionPlan {
  const blocked: BlockedOrg[] = [];
  const orgs: OrgOutcome[] = [];

  for (const membership of memberships) {
    const members = membersByOrg.get(membership.orgId) ?? [];
    const others = members.filter((m) => m.userId !== userId && isActive(m.status));
    const callerIsActiveAdmin = isActive(membership.status) && isGlobalAdmin(membership.role);
    const otherAdmins = others.filter((m) => isGlobalAdmin(m.role));

    if (callerIsActiveAdmin && others.length > 0 && otherAdmins.length === 0) {
      blocked.push({ orgId: membership.orgId, orgName: membership.orgName });
      continue;
    }
    orgs.push({
      orgId: membership.orgId,
      orgName: membership.orgName,
      soleMember: others.length === 0,
    });
  }

  if (blocked.length > 0) return { ok: false, blocked };
  return { ok: true, orgs };
}

export function blockedMessage(blocked: BlockedOrg[]): string {
  const names = blocked.map((b) => b.orgName?.trim() || 'your company').join(', ');
  return (
    `You are the only admin of ${names}, and other people still use it. ` +
    'Make someone else an admin first (Team settings on the web), then delete your account.'
  );
}

export function outcomeMessage(orgs: OrgOutcome[]): string {
  const sole = orgs.filter((o) => o.soleMember);
  const base = 'Your account was deleted. Jobs, files, and videos stay with the company.';
  if (sole.length === 0) return base;
  const names = sole.map((o) => o.orgName?.trim() || 'your company').join(', ');
  return (
    `${base} You were the only member of ${names}; its company data was left in place ` +
    'and was not deleted.'
  );
}

/** Everything the deletion needs from the database, so tests can fake it. */
export type AccountDeletionStore = {
  listMemberships(userId: string): Promise<AccountMembership[]>;
  listOrgMembers(orgId: string): Promise<OrgMemberRow[]>;
  deleteMemberships(userId: string): Promise<void>;
  deletePersonalRows(userId: string): Promise<void>;
  /** Hard-deletes the profile row; returns false when references block it. */
  deleteProfile(userId: string): Promise<boolean>;
  scrubProfile(userId: string): Promise<void>;
  /** Hard-deletes the auth user; returns false when references block it. */
  deleteAuthUser(userId: string): Promise<boolean>;
  softDeleteAuthUser(userId: string): Promise<void>;
};

export type AccountDeletionResult = {
  ok: true;
  /** 'hard' when every row was removed, 'soft' when login was wiped in place. */
  mode: 'hard' | 'soft';
  orgs: OrgOutcome[];
  message: string;
};

export async function deleteOwnAccount(
  store: AccountDeletionStore,
  userId: string,
): Promise<AccountDeletionResult> {
  const memberships = await store.listMemberships(userId);
  const membersByOrg = new Map<string, OrgMemberRow[]>();
  for (const membership of memberships) {
    membersByOrg.set(membership.orgId, await store.listOrgMembers(membership.orgId));
  }

  const plan = planAccountDeletion(userId, memberships, membersByOrg);
  if (!plan.ok) {
    throw new HttpError(409, blockedMessage(plan.blocked), 'last_admin');
  }

  await store.deleteMemberships(userId);
  await store.deletePersonalRows(userId);

  const profileDeleted = await store.deleteProfile(userId);
  if (!profileDeleted) await store.scrubProfile(userId);

  let mode: 'hard' | 'soft' = profileDeleted ? 'hard' : 'soft';
  const authDeleted = profileDeleted ? await store.deleteAuthUser(userId) : false;
  if (!authDeleted) {
    await store.softDeleteAuthUser(userId);
    mode = 'soft';
  }

  return { ok: true, mode, orgs: plan.orgs, message: outcomeMessage(plan.orgs) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Service-role implementation. Every query is pinned to the caller's own id. */
export function supabaseAccountDeletionStore(admin: SupabaseClient): AccountDeletionStore {
  return {
    async listMemberships(userId) {
      const { data, error } = await admin
        .from('org_members')
        .select('org_id, role, status, orgs(name)')
        .eq('user_id', userId);
      if (error) throw new HttpError(500, error.message, 'account_delete_failed');
      return ((data ?? []) as any[]).map((row) => ({
        orgId: String(row.org_id),
        orgName: (Array.isArray(row.orgs) ? row.orgs[0]?.name : row.orgs?.name) ?? null,
        role: row.role ?? null,
        status: row.status ?? null,
      }));
    },

    async listOrgMembers(orgId) {
      const { data, error } = await admin
        .from('org_members')
        .select('user_id, role, status')
        .eq('org_id', orgId);
      if (error) throw new HttpError(500, error.message, 'account_delete_failed');
      return ((data ?? []) as any[]).map((row) => ({
        userId: String(row.user_id),
        role: row.role ?? null,
        status: row.status ?? null,
      }));
    },

    async deleteMemberships(userId) {
      const { error } = await admin.from('org_members').delete().eq('user_id', userId);
      if (error) throw new HttpError(500, error.message, 'account_delete_failed');
    },

    async deletePersonalRows(userId) {
      // Best-effort: these tables may not exist on every deployment.
      await admin.from('voiceprints').delete().eq('user_id', userId);
      await admin.from('device_credentials').delete().eq('user_id', userId);
      // Profile photos live under `<userId>/` in the avatars bucket.
      try {
        const listed = await admin.storage.from(AVATAR_BUCKET).list(userId);
        const paths = (listed.data ?? []).map((item) => `${userId}/${item.name}`);
        if (paths.length > 0) await admin.storage.from(AVATAR_BUCKET).remove(paths);
      } catch {
        // Storage is optional on some deployments.
      }
    },

    async deleteProfile(userId) {
      const { error } = await admin.from('profiles').delete().eq('id', userId);
      return !error;
    },

    async scrubProfile(userId) {
      const full = await admin
        .from('profiles')
        .update({
          email: null,
          full_name: null,
          avatar_url: null,
          service_role: null,
          service_role_custom: null,
          handle: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (!full.error) return;
      const minimal = await admin
        .from('profiles')
        .update({ email: null, full_name: null, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (minimal.error) throw new HttpError(500, minimal.error.message, 'account_delete_failed');
    },

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      return !error;
    },

    async softDeleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId, true);
      if (error) throw new HttpError(500, error.message, 'account_delete_failed');
    },
  };
}
