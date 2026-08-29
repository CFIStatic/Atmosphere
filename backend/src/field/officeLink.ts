import type { User } from '@supabase/supabase-js';
import { createAdminClient, createUserClient } from '../lib/supabase.js';
import { FIELD_APP_CREATE_ONBOARDING, FIELD_APP_ONBOARDING } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';

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
  return `This login is already linked to ${orgName}. Enter that office’s code, or disconnect this phone and create a new login.`;
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

export async function previewOfficeByJoinCode(
  accessToken: string,
  joinCode: string,
): Promise<{ name: string; joinCode: string }> {
  const supabase = createUserClient(accessToken);
  const viaRpc = await supabase.rpc('preview_org_by_join_code', { p_code: joinCode });
  if (!viaRpc.error) {
    const row = firstRow<{ name?: string; join_code?: string }>(viaRpc.data);
    if (row?.name) {
      return { name: row.name, joinCode: row.join_code ?? joinCode };
    }
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }

  if (!/could not find|does not exist|schema cache|preview_org_by_join_code/i.test(viaRpc.error.message)) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }
  const { data } = await admin
    .from('orgs')
    .select('name, join_code')
    .eq('join_code', joinCode)
    .maybeSingle();
  if (!data?.name) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }
  return { name: data.name, joinCode: data.join_code ?? joinCode };
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
  const admin = createAdminClient();
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
 * Attach a Field Capture login to an office account (join code) or start a
 * new office. If the phone already created its own workspace, a valid office
 * join code moves the membership so day films land in the real company.
 */
export async function linkFieldOffice(
  accessToken: string,
  user: User,
  input: { joinCode?: string; orgName?: string; fullName?: string },
) {
  const supabase = await saveFieldProfile(accessToken, user, input.fullName);
  const current = await currentMembership(supabase);

  if (input.joinCode) {
    if (
      current?.org_id &&
      current.org_join_code &&
      current.org_join_code.toUpperCase() === input.joinCode
    ) {
      return serializeFieldOrg({
        id: current.org_id,
        name: current.org_name,
        join_code: current.org_join_code,
        contractor_type: current.org_contractor_type,
      });
    }

    if (current?.org_id && current.org_join_code?.toUpperCase() !== input.joinCode) {
      const admin = createAdminClient();
      if (!admin) {
        throw new HttpError(400, alreadyLinkedMessage(current.org_name || 'another office'), 'already_linked');
      }
      const { error: detachError } = await admin.from('org_members').delete().eq('user_id', user.id);
      if (detachError) {
        throw new HttpError(400, alreadyLinkedMessage(current.org_name || 'another office'), 'already_linked');
      }
    }

    const { data, error } = await supabase.rpc('join_org', {
      p_code: input.joinCode,
      p_role: FIELD_APP_ONBOARDING.role,
      p_work_type: FIELD_APP_ONBOARDING.workType,
    });
    if (error) {
      const message = /invalid join code/i.test(error.message)
        ? 'That join code did not match any organization.'
        : /already|member|belong/i.test(error.message) && current?.org_name
          ? alreadyLinkedMessage(current.org_name)
          : error.message;
      throw new HttpError(400, message, 'join_org_failed');
    }
    await saveFieldUsageIntents(supabase, user.id);
    return serializeFieldOrg(data);
  }

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
