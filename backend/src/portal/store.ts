import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import {
  defaultVisibility,
  type ConversationKind,
  type PortalConversation,
  type PortalMessage,
  type PortalPolicy,
  type PortalShare,
  type PortalVisibility,
  type MessageAuthorKind,
  type MessageTopic,
} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202']);

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) {
    throw new HttpError(
      503,
      'The HomeOwner Report tables are not set up yet. Apply supabase/migrations/20260728143000_homeowner_portal.sql, then try again.',
      'portal_schema_missing',
    );
  }
  if (error.code === '42501') {
    throw new HttpError(403, error.message, 'portal_forbidden');
  }
  throw new HttpError(500, `${action}: ${error.message}`, 'portal_store_failed');
}

export function serializeShare(r: any): PortalShare {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    label: r.label ?? null,
    customerName: r.customer_name ?? null,
    customerEmail: r.customer_email ?? null,
    status: r.status,
    expiresAt: r.expires_at ?? null,
    lastAccessedAt: r.last_accessed_at ?? null,
    welcomeNote: r.welcome_note ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revokedAt: r.revoked_at ?? null,
  };
}

export function serializeVisibility(r: any): PortalVisibility {
  return {
    projectId: r.project_id,
    orgId: r.org_id,
    showSchedule: Boolean(r.show_schedule),
    showPhaseProgress: Boolean(r.show_phase_progress),
    showMilestones: Boolean(r.show_milestones),
    showCustomerUpdates: Boolean(r.show_customer_updates),
    showDryingSummary: Boolean(r.show_drying_summary),
    showDocuments: Boolean(r.show_documents),
    showClaimBasics: Boolean(r.show_claim_basics),
    showDeductible: Boolean(r.show_deductible),
    showOfficeContact: Boolean(r.show_office_contact),
    showAdjusterContact: Boolean(r.show_adjuster_contact),
    showFieldContact: Boolean(r.show_field_contact),
    allowChat: Boolean(r.allow_chat),
    allowAdjusterChat: r.allow_adjuster_chat == null ? true : Boolean(r.allow_adjuster_chat),
    allowGroupChat: r.allow_group_chat == null ? true : Boolean(r.allow_group_chat),
    allowPolicyUpload: Boolean(r.allow_policy_upload),
    allowInsuranceQa: Boolean(r.allow_insurance_qa),
    brandName: r.brand_name ?? null,
    logoUrl: r.logo_url ?? null,
    officeName: r.office_name ?? null,
    officePhone: r.office_phone ?? null,
    officeEmail: r.office_email ?? null,
    fieldContactName: r.field_contact_name ?? null,
    fieldContactPhone: r.field_contact_phone ?? null,
    customMessage: r.custom_message ?? null,
    updatedBy: r.updated_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeConversation(r: any): PortalConversation {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    shareId: r.share_id,
    kind: r.kind,
    title: r.title,
    includesHomeowner: Boolean(r.includes_homeowner),
    includesCompany: Boolean(r.includes_company),
    includesAdjuster: Boolean(r.includes_adjuster),
    includesAssistant: Boolean(r.includes_assistant),
    status: r.status,
    lastMessageAt: r.last_message_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeMessage(r: any): PortalMessage {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    shareId: r.share_id,
    conversationId: r.conversation_id,
    authorKind: r.author_kind,
    authorUserId: r.author_user_id ?? null,
    authorName: r.author_name ?? null,
    body: r.body,
    topic: r.topic ?? null,
    createdAt: r.created_at,
  };
}

export function serializePolicy(r: any): PortalPolicy {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    shareId: r.share_id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    byteSize: r.byte_size == null ? null : Number(r.byte_size),
    contentText: r.content_text,
    summary: r.summary ?? null,
    uploadedAt: r.uploaded_at,
    createdAt: r.created_at,
  };
}

/** Public policy metadata — never return full text to the guest list UI. */
export function serializePolicyMeta(r: any) {
  return {
    id: r.id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    byteSize: r.byte_size == null ? null : Number(r.byte_size),
    summary: r.summary ?? null,
    uploadedAt: r.uploaded_at,
  };
}

export async function listShares(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PortalShare[]> {
  const { data, error } = await supabase
    .from('homeowner_portal_shares')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) fail(error, 'list portal shares');
  return (data ?? []).map(serializeShare);
}

export async function createShare(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    projectId: string;
    tokenHash: string;
    createdBy: string;
    label?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    welcomeNote?: string | null;
    expiresAt?: string | null;
  },
): Promise<PortalShare> {
  const { data, error } = await supabase
    .from('homeowner_portal_shares')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId,
      token_hash: input.tokenHash,
      created_by: input.createdBy,
      label: input.label ?? null,
      customer_name: input.customerName ?? null,
      customer_email: input.customerEmail ?? null,
      welcome_note: input.welcomeNote ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select('*')
    .single();
  if (error) fail(error, 'create portal share');
  return serializeShare(data);
}

export async function revokeShare(
  supabase: SupabaseClient,
  shareId: string,
  userId: string,
): Promise<PortalShare> {
  const { data, error } = await supabase
    .from('homeowner_portal_shares')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: userId,
    })
    .eq('id', shareId)
    .select('*')
    .single();
  if (error) fail(error, 'revoke portal share');
  return serializeShare(data);
}

export async function getVisibility(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string,
): Promise<PortalVisibility> {
  const { data, error } = await supabase
    .from('homeowner_portal_visibility')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) fail(error, 'load portal visibility');
  if (!data) return defaultVisibility(orgId, projectId);
  return serializeVisibility(data);
}

export async function upsertVisibility(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string,
  userId: string,
  patch: Partial<PortalVisibility>,
): Promise<PortalVisibility> {
  const current = await getVisibility(supabase, projectId, orgId);
  const next = { ...current, ...patch, orgId, projectId, updatedBy: userId };

  const row = {
    project_id: projectId,
    org_id: orgId,
    show_schedule: next.showSchedule,
    show_phase_progress: next.showPhaseProgress,
    show_milestones: next.showMilestones,
    show_customer_updates: next.showCustomerUpdates,
    show_drying_summary: next.showDryingSummary,
    show_documents: next.showDocuments,
    show_claim_basics: next.showClaimBasics,
    show_deductible: next.showDeductible,
    show_office_contact: next.showOfficeContact,
    show_adjuster_contact: next.showAdjusterContact,
    show_field_contact: next.showFieldContact,
    allow_chat: next.allowChat,
    allow_adjuster_chat: next.allowAdjusterChat,
    allow_group_chat: next.allowGroupChat,
    allow_policy_upload: next.allowPolicyUpload,
    allow_insurance_qa: next.allowInsuranceQa,
    brand_name: next.brandName,
    logo_url: next.logoUrl,
    office_name: next.officeName,
    office_phone: next.officePhone,
    office_email: next.officeEmail,
    field_contact_name: next.fieldContactName,
    field_contact_phone: next.fieldContactPhone,
    custom_message: next.customMessage,
    updated_by: userId,
  };

  const { data, error } = await supabase
    .from('homeowner_portal_visibility')
    .upsert(row, { onConflict: 'project_id' })
    .select('*')
    .single();
  if (error) fail(error, 'save portal visibility');
  return serializeVisibility(data);
}

export async function findShareByTokenHash(
  supabase: SupabaseClient,
  tokenHash: string,
): Promise<PortalShare | null> {
  const { data, error } = await supabase
    .from('homeowner_portal_shares')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) fail(error, 'lookup portal share');
  return data ? serializeShare(data) : null;
}

export async function touchShareAccess(
  supabase: SupabaseClient,
  shareId: string,
): Promise<void> {
  const { error } = await supabase
    .from('homeowner_portal_shares')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) fail(error, 'touch portal share');
}

/** Seed the standard side conversations for a share (idempotent). */
export async function ensureConversations(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    projectId: string;
    shareId: string;
    brandName: string;
    adjusterName: string | null;
    visibility: PortalVisibility;
  },
): Promise<PortalConversation[]> {
  const specs: {
    kind: ConversationKind;
    title: string;
    includesCompany: boolean;
    includesAdjuster: boolean;
    includesAssistant: boolean;
    enabled: boolean;
  }[] = [
    {
      kind: 'assistant',
      title: `Ask ${input.brandName}`,
      includesCompany: false,
      includesAdjuster: false,
      includesAssistant: true,
      enabled: input.visibility.allowInsuranceQa,
    },
    {
      kind: 'company',
      title: input.brandName,
      includesCompany: true,
      includesAdjuster: false,
      includesAssistant: false,
      enabled: input.visibility.allowChat,
    },
    {
      kind: 'adjuster',
      title: input.adjusterName ? `Adjuster · ${input.adjusterName}` : 'Insurance adjuster',
      includesCompany: false,
      includesAdjuster: true,
      includesAssistant: false,
      enabled: input.visibility.allowAdjusterChat,
    },
    {
      kind: 'group',
      title: input.adjusterName
        ? `You, ${input.brandName} & ${input.adjusterName}`
        : `You, ${input.brandName} & adjuster`,
      includesCompany: true,
      includesAdjuster: true,
      includesAssistant: false,
      enabled: input.visibility.allowGroupChat,
    },
  ];

  const rows = specs
    .filter((s) => s.enabled)
    .map((s) => ({
      org_id: input.orgId,
      project_id: input.projectId,
      share_id: input.shareId,
      kind: s.kind,
      title: s.title,
      includes_homeowner: true,
      includes_company: s.includesCompany,
      includes_adjuster: s.includesAdjuster,
      includes_assistant: s.includesAssistant,
    }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('homeowner_portal_conversations')
      .upsert(rows, { onConflict: 'share_id,kind', ignoreDuplicates: true });
    if (error) fail(error, 'seed portal conversations');
  }

  return listConversations(supabase, input.shareId);
}

export async function listConversations(
  supabase: SupabaseClient,
  shareId: string,
): Promise<PortalConversation[]> {
  const { data, error } = await supabase
    .from('homeowner_portal_conversations')
    .select('*')
    .eq('share_id', shareId)
    .eq('status', 'open')
    .order('kind', { ascending: true });
  if (error) fail(error, 'list portal conversations');
  return (data ?? []).map(serializeConversation);
}

export async function listProjectConversations(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PortalConversation[]> {
  const { data, error } = await supabase
    .from('homeowner_portal_conversations')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) fail(error, 'list project conversations');
  return (data ?? []).map(serializeConversation);
}

export async function getConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<PortalConversation | null> {
  const { data, error } = await supabase
    .from('homeowner_portal_conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) fail(error, 'load portal conversation');
  return data ? serializeConversation(data) : null;
}

export async function listMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 200,
): Promise<PortalMessage[]> {
  const { data, error } = await supabase
    .from('homeowner_portal_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) fail(error, 'list portal messages');
  return (data ?? []).map(serializeMessage);
}

export async function listProjectMessages(
  supabase: SupabaseClient,
  projectId: string,
  limit = 100,
): Promise<PortalMessage[]> {
  const { data, error } = await supabase
    .from('homeowner_portal_messages')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'list project portal messages');
  return (data ?? []).map(serializeMessage);
}

export async function insertMessage(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    projectId: string;
    shareId: string;
    conversationId: string;
    authorKind: MessageAuthorKind;
    authorUserId?: string | null;
    authorName?: string | null;
    body: string;
    topic?: MessageTopic | null;
  },
): Promise<PortalMessage> {
  const { data, error } = await supabase
    .from('homeowner_portal_messages')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId,
      share_id: input.shareId,
      conversation_id: input.conversationId,
      author_kind: input.authorKind,
      author_user_id: input.authorUserId ?? null,
      author_name: input.authorName ?? null,
      body: input.body,
      topic: input.topic ?? null,
    })
    .select('*')
    .single();
  if (error) fail(error, 'insert portal message');
  return serializeMessage(data);
}

export async function listPolicies(
  supabase: SupabaseClient,
  shareId: string,
): Promise<ReturnType<typeof serializePolicyMeta>[]> {
  const { data, error } = await supabase
    .from('homeowner_portal_policies')
    .select('id, file_name, mime_type, byte_size, summary, uploaded_at')
    .eq('share_id', shareId)
    .order('uploaded_at', { ascending: false });
  if (error) fail(error, 'list portal policies');
  return (data ?? []).map(serializePolicyMeta);
}

export async function getLatestPolicyText(
  supabase: SupabaseClient,
  shareId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('homeowner_portal_policies')
    .select('content_text')
    .eq('share_id', shareId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail(error, 'load portal policy text');
  return data?.content_text ?? null;
}

export async function insertPolicy(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    projectId: string;
    shareId: string;
    fileName: string;
    mimeType: string;
    contentText: string;
    byteSize?: number | null;
    summary?: string | null;
  },
): Promise<ReturnType<typeof serializePolicyMeta>> {
  const { data, error } = await supabase
    .from('homeowner_portal_policies')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId,
      share_id: input.shareId,
      file_name: input.fileName,
      mime_type: input.mimeType,
      content_text: input.contentText,
      byte_size: input.byteSize ?? null,
      summary: input.summary ?? null,
    })
    .select('id, file_name, mime_type, byte_size, summary, uploaded_at')
    .single();
  if (error) fail(error, 'upload portal policy');
  return serializePolicyMeta(data);
}

export async function getOrgName(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await supabase.from('orgs').select('name').eq('id', orgId).maybeSingle();
  if (error) fail(error, 'load org name');
  return data?.name ?? null;
}
