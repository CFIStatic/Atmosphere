/**
 * Persistence for PM orchestration tables.
 *
 * Same contract as ../store.ts: caller's JWT, RLS is the boundary, nothing
 * deleted — rows are cancelled / ignored / rejected in place.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import type {
  Approval,
  Communication,
  EquipmentPlan,
  EquipmentPlanItem,
  PlatformConnection,
  PlatformEvent,
  PlatformLink,
  ProcurementBid,
  ProcurementRequest,
  VendorReferral,
} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202']);

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) {
    throw new HttpError(
      503,
      'PM orchestration tables are not set up yet. Apply supabase/migrations/20260728142600_pm_orchestration.sql, then try again.',
      'pm_orchestration_schema_missing',
    );
  }
  if (error.code === '42501') {
    throw new HttpError(403, error.message, 'pm_forbidden');
  }
  throw new HttpError(500, `${action}: ${error.message}`, 'pm_orchestration_failed');
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function serializeConnection(r: any): PlatformConnection {
  return {
    id: r.id,
    orgId: r.org_id,
    platform: r.platform,
    label: r.label ?? null,
    status: r.status,
    externalAccountId: r.external_account_id ?? null,
    lastSyncedAt: r.last_synced_at ?? null,
    lastError: r.last_error ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    connectedBy: r.connected_by ?? null,
    connectedAt: r.connected_at,
    disconnectedAt: r.disconnected_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeLink(r: any): PlatformLink {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    platform: r.platform,
    externalId: r.external_id,
    externalUrl: r.external_url ?? null,
    externalLabel: r.external_label ?? null,
    syncStatus: r.sync_status,
    lastSyncedAt: r.last_synced_at ?? null,
    lastError: r.last_error ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    linkedBy: r.linked_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeEvent(r: any): PlatformEvent {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id ?? null,
    platform: r.platform,
    eventKind: r.event_kind,
    direction: r.direction,
    summary: r.summary,
    detail: r.detail ?? null,
    externalId: r.external_id ?? null,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    requiresApproval: Boolean(r.requires_approval),
    approvalId: r.approval_id ?? null,
    occurredAt: r.occurred_at,
    recordedBy: r.recorded_by ?? null,
    createdAt: r.created_at,
  };
}

export function serializeCommunication(r: any): Communication {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id ?? null,
    channel: r.channel,
    direction: r.direction,
    intake: r.intake,
    counterpartyName: r.counterparty_name ?? null,
    counterpartyHandle: r.counterparty_handle ?? null,
    counterpartyKind: r.counterparty_kind,
    body: r.body,
    mentionExcerpt: r.mention_excerpt ?? null,
    threadKey: r.thread_key ?? null,
    externalMessageId: r.external_message_id ?? null,
    fingerprint: r.fingerprint,
    status: r.status,
    reviewedAt: r.reviewed_at ?? null,
    reviewedBy: r.reviewed_by ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeApproval(r: any): Approval {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id ?? null,
    kind: r.kind,
    title: r.title,
    detail: r.detail ?? null,
    proposedAction: (r.proposed_action ?? {}) as Record<string, unknown>,
    platform: r.platform ?? null,
    priority: r.priority,
    status: r.status,
    requestedBy: r.requested_by ?? null,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ?? null,
    decisionNote: r.decision_note ?? null,
    executedAt: r.executed_at ?? null,
    executionResult: (r.execution_result ?? {}) as Record<string, unknown>,
    expiresAt: r.expires_at ?? null,
    sourceRef: r.source_ref ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializePlan(r: any): EquipmentPlan {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    source: r.source,
    sourceRef: r.source_ref ?? null,
    status: r.status,
    summary: r.summary ?? null,
    dumpsterRequired: Boolean(r.dumpster_required),
    createdBy: r.created_by ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializePlanItem(r: any): EquipmentPlanItem {
  return {
    id: r.id,
    orgId: r.org_id,
    planId: r.plan_id,
    projectId: r.project_id,
    itemKind: r.item_kind,
    label: r.label,
    quantity: Number(r.quantity),
    unit: r.unit,
    fulfillment: r.fulfillment,
    status: r.status,
    notes: r.notes ?? null,
    estimateCode: r.estimate_code ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeReferral(r: any): VendorReferral {
  return {
    id: r.id,
    orgId: r.org_id ?? null,
    vendorKey: r.vendor_key,
    name: r.name,
    category: r.category,
    baseUrl: r.base_url,
    linkTemplate: r.link_template,
    referralParam: r.referral_param,
    atmosphereRefCode: r.atmosphere_ref_code,
    commissionBps: Number(r.commission_bps),
    active: Boolean(r.active),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeProcurement(r: any): ProcurementRequest {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    planItemId: r.plan_item_id ?? null,
    kind: r.kind,
    title: r.title,
    description: r.description ?? null,
    quantity: num(r.quantity),
    unit: r.unit ?? null,
    shipToPostal: r.ship_to_postal ?? null,
    shipToAddress: r.ship_to_address ?? null,
    status: r.status,
    selectedBidId: r.selected_bid_id ?? null,
    referralVendorKey: r.referral_vendor_key ?? null,
    referralUrl: r.referral_url ?? null,
    approvalId: r.approval_id ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeBid(r: any): ProcurementBid {
  return {
    id: r.id,
    orgId: r.org_id,
    requestId: r.request_id,
    projectId: r.project_id,
    vendorName: r.vendor_name,
    vendorUrl: r.vendor_url ?? null,
    vendorPhone: r.vendor_phone ?? null,
    amountCents: num(r.amount_cents),
    currency: r.currency,
    leadDays: num(r.lead_days),
    notes: r.notes ?? null,
    source: r.source,
    status: r.status,
    raw: (r.raw ?? {}) as Record<string, unknown>,
    collectedAt: r.collected_at,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listConnections(
  supabase: SupabaseClient,
  orgId: string,
): Promise<PlatformConnection[]> {
  const { data, error } = await supabase
    .from('pm_platform_connections')
    .select('*')
    .eq('org_id', orgId)
    .order('platform');
  if (error) fail(error, 'list platform connections');
  return (data ?? []).map(serializeConnection);
}

export async function listLinks(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string } = {},
): Promise<PlatformLink[]> {
  let q = supabase.from('pm_platform_links').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) fail(error, 'list platform links');
  return (data ?? []).map(serializeLink);
}

export async function listPlatformEvents(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; limit?: number } = {},
): Promise<PlatformEvent[]> {
  let q = supabase.from('pm_platform_events').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  const { data, error } = await q
    .order('occurred_at', { ascending: false })
    .limit(options.limit ?? 100);
  if (error) fail(error, 'list platform events');
  return (data ?? []).map(serializeEvent);
}

export async function listCommunications(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; status?: string[]; limit?: number } = {},
): Promise<Communication[]> {
  let q = supabase.from('pm_communications').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q
    .order('occurred_at', { ascending: false })
    .limit(options.limit ?? 100);
  if (error) fail(error, 'list communications');
  return (data ?? []).map(serializeCommunication);
}

export async function listApprovals(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; status?: string[]; limit?: number } = {},
): Promise<Approval[]> {
  let q = supabase.from('pm_approvals').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q
    .order('created_at', { ascending: true })
    .limit(options.limit ?? 100);
  if (error) fail(error, 'list approvals');
  return (data ?? []).map(serializeApproval);
}

export async function listEquipmentPlans(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string } = {},
): Promise<EquipmentPlan[]> {
  let q = supabase.from('pm_equipment_plans').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) fail(error, 'list equipment plans');
  return (data ?? []).map(serializePlan);
}

export async function listPlanItems(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; planId?: string; status?: string[] } = {},
): Promise<EquipmentPlanItem[]> {
  let q = supabase.from('pm_equipment_plan_items').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  if (options.planId) q = q.eq('plan_id', options.planId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q.order('created_at');
  if (error) fail(error, 'list plan items');
  return (data ?? []).map(serializePlanItem);
}

export async function listReferrals(
  supabase: SupabaseClient,
  orgId: string,
): Promise<VendorReferral[]> {
  // Global catalogue (org_id is null) plus this org's overrides.
  const { data, error } = await supabase
    .from('pm_vendor_referrals')
    .select('*')
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .eq('active', true)
    .order('name');
  if (error) fail(error, 'list vendor referrals');
  return (data ?? []).map(serializeReferral);
}

export async function listProcurement(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; status?: string[]; limit?: number } = {},
): Promise<ProcurementRequest[]> {
  let q = supabase.from('pm_procurement_requests').select('*').eq('org_id', orgId);
  if (options.projectId) q = q.eq('project_id', options.projectId);
  if (options.status?.length) q = q.in('status', options.status);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100);
  if (error) fail(error, 'list procurement');
  return (data ?? []).map(serializeProcurement);
}

export async function listBids(
  supabase: SupabaseClient,
  requestId: string,
): Promise<ProcurementBid[]> {
  const { data, error } = await supabase
    .from('pm_procurement_bids')
    .select('*')
    .eq('request_id', requestId)
    .order('amount_cents', { ascending: true, nullsFirst: false });
  if (error) fail(error, 'list bids');
  return (data ?? []).map(serializeBid);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export async function upsertConnection(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    platform: string;
    label?: string | null;
    status?: string;
    external_account_id?: string | null;
    metadata?: Record<string, unknown>;
    connected_by?: string | null;
  },
): Promise<PlatformConnection> {
  const row = {
    org_id: orgId,
    platform: input.platform,
    label: input.label ?? null,
    status: input.status ?? 'connected',
    external_account_id: input.external_account_id ?? null,
    metadata: input.metadata ?? {},
    connected_by: input.connected_by ?? null,
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    last_error: null,
  };
  const { data, error } = await supabase
    .from('pm_platform_connections')
    .upsert(row, { onConflict: 'org_id,platform' })
    .select('*')
    .single();
  if (error) fail(error, 'upsert platform connection');
  return serializeConnection(data);
}

export async function createLink(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<PlatformLink> {
  const { data, error } = await supabase
    .from('pm_platform_links')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'create platform link');
  return serializeLink(data);
}

export async function recordPlatformEvent(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<PlatformEvent> {
  const { data, error } = await supabase
    .from('pm_platform_events')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'record platform event');
  return serializeEvent(data);
}

export async function insertCommunication(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<Communication> {
  const { data, error } = await supabase
    .from('pm_communications')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) {
    // Duplicate fingerprint from a bridge retry — return the existing row.
    if (error.code === '23505') {
      const { data: existing, error: readErr } = await supabase
        .from('pm_communications')
        .select('*')
        .eq('org_id', orgId)
        .eq('fingerprint', input.fingerprint as string)
        .maybeSingle();
      if (readErr || !existing) fail(error, 'insert communication');
      return serializeCommunication(existing);
    }
    fail(error, 'insert communication');
  }
  return serializeCommunication(data);
}

export async function updateCommunication(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Communication> {
  const { data, error } = await supabase
    .from('pm_communications')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update communication');
  return serializeCommunication(data);
}

export async function createApproval(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<Approval> {
  const { data, error } = await supabase
    .from('pm_approvals')
    .insert({ ...input, org_id: orgId, status: input.status ?? 'pending' })
    .select('*')
    .single();
  if (error) fail(error, 'create approval');
  return serializeApproval(data);
}

export async function updateApproval(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Approval> {
  const { data, error } = await supabase
    .from('pm_approvals')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update approval');
  return serializeApproval(data);
}

export async function createEquipmentPlan(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<EquipmentPlan> {
  const { data, error } = await supabase
    .from('pm_equipment_plans')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'create equipment plan');
  return serializePlan(data);
}

export async function insertPlanItems(
  supabase: SupabaseClient,
  orgId: string,
  rows: Record<string, unknown>[],
): Promise<EquipmentPlanItem[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('pm_equipment_plan_items')
    .insert(rows.map((r) => ({ ...r, org_id: orgId })))
    .select('*');
  if (error) fail(error, 'insert plan items');
  return (data ?? []).map(serializePlanItem);
}

export async function updateEquipmentPlan(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<EquipmentPlan> {
  const { data, error } = await supabase
    .from('pm_equipment_plans')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update equipment plan');
  return serializePlan(data);
}

export async function createProcurementRequest(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<ProcurementRequest> {
  const { data, error } = await supabase
    .from('pm_procurement_requests')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'create procurement request');
  return serializeProcurement(data);
}

export async function updateProcurementRequest(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<ProcurementRequest> {
  const { data, error } = await supabase
    .from('pm_procurement_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update procurement request');
  return serializeProcurement(data);
}

export async function insertBids(
  supabase: SupabaseClient,
  orgId: string,
  rows: Record<string, unknown>[],
): Promise<ProcurementBid[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('pm_procurement_bids')
    .insert(rows.map((r) => ({ ...r, org_id: orgId })))
    .select('*');
  if (error) fail(error, 'insert bids');
  return (data ?? []).map(serializeBid);
}

export async function updateBid(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<ProcurementBid> {
  const { data, error } = await supabase
    .from('pm_procurement_bids')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error, 'update bid');
  return serializeBid(data);
}

/** Match an inbound message to a project by phone, claim, or address fragment. */
export async function findProjectForMention(
  supabase: SupabaseClient,
  orgId: string,
  hints: { phone?: string | null; claimNumber?: string | null; addressHint?: string | null },
): Promise<{ id: string; project_number: string; name: string } | null> {
  if (hints.claimNumber) {
    const { data } = await supabase
      .from('pm_projects')
      .select('id, project_number, name')
      .eq('org_id', orgId)
      .eq('claim_number', hints.claimNumber)
      .in('status', ['active', 'on_hold'])
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  if (hints.phone) {
    const digits = hints.phone.replace(/\D/g, '');
    if (digits.length >= 7) {
      const { data } = await supabase
        .from('pm_projects')
        .select('id, project_number, name, customer_phone')
        .eq('org_id', orgId)
        .in('status', ['active', 'on_hold'])
        .limit(50);
      const match = (data ?? []).find((p) => {
        const phone = String(p.customer_phone ?? '').replace(/\D/g, '');
        return phone && (phone.endsWith(digits) || digits.endsWith(phone));
      });
      if (match) return { id: match.id, project_number: match.project_number, name: match.name };
    }
  }
  if (hints.addressHint && hints.addressHint.trim().length >= 4) {
    const needle = hints.addressHint.trim().toLowerCase();
    const { data } = await supabase
      .from('pm_projects')
      .select('id, project_number, name, address_line1, name')
      .eq('org_id', orgId)
      .in('status', ['active', 'on_hold'])
      .limit(50);
    const match = (data ?? []).find((p) => {
      const addr = String(p.address_line1 ?? '').toLowerCase();
      const name = String(p.name ?? '').toLowerCase();
      return addr.includes(needle) || name.includes(needle) || needle.includes(addr);
    });
    if (match) return { id: match.id, project_number: match.project_number, name: match.name };
  }
  return null;
}
