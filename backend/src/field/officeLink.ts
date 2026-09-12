import type { User } from '@supabase/supabase-js';
import { createUserClient } from '../lib/supabase.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { FIELD_APP_CREATE_ONBOARDING, FIELD_APP_ONBOARDING } from '../lib/validation.js';
import { requirePendingOrgInvite } from '../lib/orgInviteGate.js';
import { HttpError } from '../lib/errors.js';
import { fcSeatLimitFromDb, isFcSeatLimitDbError } from '../lib/fieldCaptureSeats.js';

export function serializeFieldOrg(org: {
  id?: string;
  name?: string;
  join_code?: string;
  contractor_type?: string | null;
} | null) {
  if (!org?.id) return null;
  return {
    id: org.id,
    name: org.name ?? 'Organization',
    joinCode: org.join_code ?? null,
    contractorType: org.contractor_type ?? null,
  };
}

export function alreadyLinkedMessage(orgName: string) {
  return `This login is already linked to ${orgName}.`;
}

type MembershipRow = {
  org_id?: string;
  org_name?: string;
  org_join_code?: string;
  org_contractor_type?: string | null;
};

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

async function currentMembership(supabase: ReturnType<typeof createUserClient>) {
  const { data } = await supabase.rpc('my_org_membership');
  return firstRow<MembershipRow>(data);
}

async function saveFieldProfile(accessToken: string, user: User, fullName?: string) {
  const supabase = createUserClient(accessToken);
  await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      ...(fullName ? { full_name: fullName, updated_at: new Date().toISOString() } : {}),
    },
    { onConflict: 'id' },
  );
  return supabase;
}

async function saveFieldUsageIntents(
  supabase: ReturnType<typeof createUserClient>,
  userId: string,
  usageIntents: readonly string[] = FIELD_APP_ONBOARDING.usageIntents,
) {
  const admin = unscopedAdminOrNull();
  const writer = admin ?? supabase;
  const { error } = await writer
    .from('org_members')
    .update({ usage_intents: [...usageIntents] })
    .eq('user_id', userId);
  if (
    error &&
    !/usage_intents|column .* does not exist|permission denied for function is_org_member/i.test(
      error.message,
    )
  ) {
    throw new HttpError(500, error.message, 'usage_intents_failed');
  }
}

/**
 * Attach a Field Capture login to an office via a pending email invite, or
 * start a new office. Clients never send a join code.
 */
export async function linkFieldOffice(
  accessToken: string,
  user: User,
  input: { orgName?: string; fullName?: string },
) {
  const supabase = await saveFieldProfile(accessToken, user, input.fullName);
  const current = await currentMembership(supabase);

  if (current?.org_id && !input.orgName) {
    return serializeFieldOrg({
      id: current.org_id,
      name: current.org_name,
      join_code: current.org_join_code,
      contractor_type: current.org_contractor_type,
    });
  }

  if (input.orgName) {
    if (current?.org_id) {
      throw new HttpError(400, alreadyLinkedMessage(current.org_name || 'an office'), 'already_linked');
    }

    const { data, error } = await supabase.rpc('create_org', {
      p_name: input.orgName,
      p_role: FIELD_APP_CREATE_ONBOARDING.role,
      p_work_type: FIELD_APP_CREATE_ONBOARDING.workType,
    });
    if (error) throw new HttpError(400, error.message, 'create_org_failed');

    const { data: orgWithType, error: typeError } = await supabase.rpc('set_org_contractor_type', {
      p_contractor_type: FIELD_APP_CREATE_ONBOARDING.contractorType,
    });
    if (
      typeError &&
      !/could not find|does not exist|schema cache|contractor_type/i.test(typeError.message)
    ) {
      throw new HttpError(400, typeError.message, 'contractor_type_failed');
    }

    await saveFieldUsageIntents(supabase, user.id, [...FIELD_APP_CREATE_ONBOARDING.usageIntents]);
    return serializeFieldOrg(orgWithType ?? data);
  }

  if (current?.org_id) {
    throw new HttpError(400, alreadyLinkedMessage(current.org_name || 'an office'), 'already_linked');
  }

  const invite = await requirePendingOrgInvite({
    email: user.email,
  });
  const { data, error } = await supabase.rpc('join_org', {
    p_code: invite.joinCode,
    p_role: invite.role,
    p_work_type: FIELD_APP_ONBOARDING.workType,
  });
  if (error) {
    if (isFcSeatLimitDbError(error)) {
      throw fcSeatLimitFromDb();
    }
    const message = /invalid join code/i.test(error.message)
      ? 'Could not join that organization.'
      : /already|member|belong/i.test(error.message) && current?.org_name
        ? alreadyLinkedMessage(current.org_name)
        : error.message;
    throw new HttpError(400, message, 'join_org_failed');
  }
  await saveFieldUsageIntents(supabase, user.id);
  return serializeFieldOrg(data);
}
