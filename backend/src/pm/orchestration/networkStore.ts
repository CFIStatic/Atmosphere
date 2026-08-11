/**
 * Persistence for the partner network and adaptive internal threads.
 */

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import type {
  PartnerInvite,
  PartnerProfile,
  Partnership,
  Thread,
  ThreadMessage,
  ThreadParticipant,
} from './networkTypes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202']);

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code && MISSING.has(error.code)) {
    throw new HttpError(
      503,
      'Partner network / internal comms tables are not set up yet. Apply supabase/migrations/20260728150001_pm_network_and_comms.sql.',
      'pm_network_schema_missing',
    );
  }
  if (error.code === '42501') throw new HttpError(403, error.message, 'pm_forbidden');
  throw new HttpError(500, `${action}: ${error.message}`, 'pm_network_failed');
}

export function newInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

export function serializeProfile(r: any): PartnerProfile {
  return {
    orgId: r.org_id,
    displayName: r.display_name,
    kind: r.kind,
    blurb: r.blurb ?? null,
    trades: r.trades ?? [],
    serviceAreas: r.service_areas ?? [],
    phone: r.phone ?? null,
    email: r.email ?? null,
    website: r.website ?? null,
    jobsCompleted: Number(r.jobs_completed ?? 0),
    invitesSent: Number(r.invites_sent ?? 0),
    invitesAccepted: Number(r.invites_accepted ?? 0),
    avgResponseHours: r.avg_response_hours == null ? null : Number(r.avg_response_hours),
    discoverable: Boolean(r.discoverable),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeInvite(r: any): PartnerInvite {
  return {
    id: r.id,
    orgId: r.org_id,
    inviteeKind: r.invitee_kind,
    inviteeName: r.invitee_name,
    inviteeEmail: r.invitee_email ?? null,
    inviteePhone: r.invitee_phone ?? null,
    inviteeCompany: r.invitee_company ?? null,
    trades: r.trades ?? [],
    message: r.message ?? null,
    token: r.token,
    status: r.status,
    crmAccountId: r.crm_account_id ?? null,
    projectId: r.project_id ?? null,
    invitedBy: r.invited_by ?? null,
    acceptedOrgId: r.accepted_org_id ?? null,
    acceptedAt: r.accepted_at ?? null,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializePartnership(r: any): Partnership {
  return {
    id: r.id,
    orgId: r.org_id,
    partnerOrgId: r.partner_org_id,
    partnerKind: r.partner_kind,
    status: r.status,
    inviteId: r.invite_id ?? null,
    preferred: Boolean(r.preferred),
    notes: r.notes ?? null,
    sharedJobs: Number(r.shared_jobs ?? 0),
    lastCollaboratedAt: r.last_collaborated_at ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeThread(r: any): Thread {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id ?? null,
    partnershipId: r.partnership_id ?? null,
    kind: r.kind,
    mode: r.mode,
    title: r.title,
    status: r.status,
    originKey: r.origin_key ?? null,
    originRef: r.origin_ref ?? null,
    urgency: r.urgency,
    lastMessageAt: r.last_message_at ?? null,
    resolvedAt: r.resolved_at ?? null,
    resolvedBy: r.resolved_by ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeParticipant(r: any): ThreadParticipant {
  return {
    id: r.id,
    orgId: r.org_id,
    threadId: r.thread_id,
    userId: r.user_id ?? null,
    partnerOrgId: r.partner_org_id ?? null,
    roleInThread: r.role_in_thread,
    joinedAt: r.joined_at,
    lastReadAt: r.last_read_at ?? null,
    muted: Boolean(r.muted),
  };
}

export function serializeMessage(r: any): ThreadMessage {
  return {
    id: r.id,
    orgId: r.org_id,
    threadId: r.thread_id,
    authorUserId: r.author_user_id ?? null,
    authorKind: r.author_kind,
    body: r.body,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ *
 * Profiles / invites / partnerships
 * ------------------------------------------------------------------ */

export async function getOwnProfile(
  supabase: SupabaseClient,
  orgId: string,
): Promise<PartnerProfile | null> {
  const { data, error } = await supabase
    .from('pm_partner_profiles')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) fail(error, 'get partner profile');
  return data ? serializeProfile(data) : null;
}

export async function upsertProfile(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<PartnerProfile> {
  const row = { org_id: orgId, ...input };
  const { data, error } = await supabase
    .from('pm_partner_profiles')
    .upsert(row, { onConflict: 'org_id' })
    .select('*')
    .single();
  if (error) fail(error, 'upsert partner profile');
  return serializeProfile(data);
}

export async function listInvites(
  supabase: SupabaseClient,
  orgId: string,
  options: { status?: string[] } = {},
): Promise<PartnerInvite[]> {
  let q = supabase.from('pm_partner_invites').select('*').eq('org_id', orgId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) fail(error, 'list partner invites');
  return (data ?? []).map(serializeInvite);
}

export async function createInvite(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<PartnerInvite> {
  const { data, error } = await supabase
    .from('pm_partner_invites')
    .insert({ ...input, org_id: orgId, token: input.token ?? newInviteToken() })
    .select('*')
    .single();
  if (error) fail(error, 'create partner invite');
  return serializeInvite(data);
}

export async function updateInvite(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<PartnerInvite> {
  const { data, error } = await supabase
    .from('pm_partner_invites')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update partner invite');
  return serializeInvite(data);
}

export async function findInviteByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<PartnerInvite | null> {
  const { data, error } = await supabase
    .from('pm_partner_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) fail(error, 'find invite by token');
  return data ? serializeInvite(data) : null;
}

export async function listPartnerships(
  supabase: SupabaseClient,
  orgId: string,
  options: { status?: string[] } = {},
): Promise<Partnership[]> {
  let q = supabase.from('pm_partnerships').select('*').eq('org_id', orgId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q.order('preferred', { ascending: false }).limit(200);
  if (error) fail(error, 'list partnerships');
  return (data ?? []).map(serializePartnership);
}

export async function createPartnership(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<Partnership> {
  const { data, error } = await supabase
    .from('pm_partnerships')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'create partnership');
  return serializePartnership(data);
}

export async function updatePartnership(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Partnership> {
  const { data, error } = await supabase
    .from('pm_partnerships')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update partnership');
  return serializePartnership(data);
}

export async function bumpInviteCounters(
  supabase: SupabaseClient,
  orgId: string,
  field: 'invites_sent' | 'invites_accepted',
): Promise<void> {
  const profile = await getOwnProfile(supabase, orgId);
  if (!profile) return;
  const next =
    field === 'invites_sent' ? profile.invitesSent + 1 : profile.invitesAccepted + 1;
  await supabase
    .from('pm_partner_profiles')
    .update({ [field]: next })
    .eq('org_id', orgId);
}

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

export async function listThreads(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; status?: string[]; limit?: number } = {},
): Promise<Thread[]> {
  let q = supabase.from('pm_threads').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(options.limit ?? 100);
  if (error) fail(error, 'list threads');
  return (data ?? []).map(serializeThread);
}

export async function getThreadByOrigin(
  supabase: SupabaseClient,
  orgId: string,
  originKey: string,
): Promise<Thread | null> {
  const { data, error } = await supabase
    .from('pm_threads')
    .select('*')
    .eq('org_id', orgId)
    .eq('origin_key', originKey)
    .maybeSingle();
  if (error) fail(error, 'get thread by origin');
  return data ? serializeThread(data) : null;
}

export async function createThread(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<Thread> {
  const { data, error } = await supabase
    .from('pm_threads')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505' && input.origin_key) {
      const existing = await getThreadByOrigin(supabase, orgId, String(input.origin_key));
      if (existing) return existing;
    }
    fail(error, 'create thread');
  }
  return serializeThread(data);
}

export async function updateThread(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Thread> {
  const { data, error } = await supabase
    .from('pm_threads')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update thread');
  return serializeThread(data);
}

export async function addParticipant(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<ThreadParticipant> {
  const { data, error } = await supabase
    .from('pm_thread_participants')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      let q = supabase
        .from('pm_thread_participants')
        .select('*')
        .eq('thread_id', input.thread_id as string);
      if (input.user_id) q = q.eq('user_id', input.user_id as string);
      if (input.partner_org_id) q = q.eq('partner_org_id', input.partner_org_id as string);
      const { data: existing, error: readErr } = await q.maybeSingle();
      if (readErr || !existing) fail(error, 'add participant');
      return serializeParticipant(existing);
    }
    fail(error, 'add participant');
  }
  return serializeParticipant(data);
}

export async function listParticipants(
  supabase: SupabaseClient,
  threadId: string,
): Promise<ThreadParticipant[]> {
  const { data, error } = await supabase
    .from('pm_thread_participants')
    .select('*')
    .eq('thread_id', threadId);
  if (error) fail(error, 'list participants');
  return (data ?? []).map(serializeParticipant);
}

export async function listMessages(
  supabase: SupabaseClient,
  threadId: string,
  options: { limit?: number } = {},
): Promise<ThreadMessage[]> {
  const { data, error } = await supabase
    .from('pm_thread_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(options.limit ?? 200);
  if (error) fail(error, 'list messages');
  return (data ?? []).map(serializeMessage);
}

export async function postMessage(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<ThreadMessage> {
  const { data, error } = await supabase
    .from('pm_thread_messages')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'post message');
  return serializeMessage(data);
}
