/**
 * Platform orchestration — Dash, XactAnalysis, Xactimate, Outlook.
 *
 * Pulls status into Atmosphere and queues outbound writes as approvals. Live
 * vendor HTTP lives in the estimator connectors; this module records links,
 * sync events, and proposed actions without bypassing the human gate.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import * as orch from './store.js';
import type { OrchestrationPlatform, PlatformConnection, PlatformEvent, PlatformLink } from './types.js';

export const PLATFORM_CATALOGUE: {
  platform: OrchestrationPlatform;
  label: string;
  description: string;
}[] = [
  {
    platform: 'dash',
    label: 'Dash',
    description: 'Job CRM — status, notes, documents, and claim linkage.',
  },
  {
    platform: 'xactanalysis',
    label: 'XactAnalysis',
    description: 'Carrier assignment and estimate workflow with Verisk.',
  },
  {
    platform: 'xactimate',
    label: 'Xactimate',
    description: 'Estimate line items — reads feed equipment plans; writes need approval.',
  },
  {
    platform: 'outlook',
    label: 'Outlook',
    description: 'Email threads with adjusters, vendors and customers — documented, not auto-sent.',
  },
];

export async function connectPlatform(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  platform: OrchestrationPlatform,
  input: { label?: string | null; externalAccountId?: string | null } = {},
): Promise<PlatformConnection> {
  return orch.upsertConnection(supabase, orgId, {
    platform,
    label: input.label ?? PLATFORM_CATALOGUE.find((p) => p.platform === platform)?.label ?? platform,
    status: 'connected',
    external_account_id: input.externalAccountId ?? null,
    connected_by: userId,
    metadata: { connectedVia: 'pm_orchestration' },
  });
}

export async function disconnectPlatform(
  supabase: SupabaseClient,
  orgId: string,
  platform: OrchestrationPlatform,
): Promise<PlatformConnection> {
  return orch.upsertConnection(supabase, orgId, {
    platform,
    status: 'disconnected',
    metadata: { disconnectedAt: new Date().toISOString() },
  });
}

export async function linkProjectToPlatform(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: {
    projectId: string;
    platform: OrchestrationPlatform;
    externalId: string;
    externalUrl?: string | null;
    externalLabel?: string | null;
  },
): Promise<{ link: PlatformLink; event: PlatformEvent }> {
  const link = await orch.createLink(supabase, orgId, {
    project_id: input.projectId,
    platform: input.platform,
    external_id: input.externalId,
    external_url: input.externalUrl ?? null,
    external_label: input.externalLabel ?? null,
    sync_status: 'linked',
    linked_by: userId,
  });

  const event = await orch.recordPlatformEvent(supabase, orgId, {
    project_id: input.projectId,
    platform: input.platform,
    event_kind: 'linked',
    direction: 'internal',
    summary: `Linked to ${input.platform} ${input.externalLabel || input.externalId}`,
    external_id: input.externalId,
    recorded_by: userId,
    requires_approval: false,
  });

  return { link, event };
}

/**
 * Record a sync pass for one project link.
 *
 * Real connector pulls belong in estimator adapters; here we stamp the link,
 * append an event, and — when the payload says something irreversible is
 * needed — open an approval instead of writing out.
 */
export async function syncPlatformLink(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: {
    linkId: string;
    summary: string;
    detail?: string | null;
    payload?: Record<string, unknown>;
    proposeAction?: {
      kind: string;
      title: string;
      detail?: string;
      proposedAction: Record<string, unknown>;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    } | null;
  },
): Promise<{ link: PlatformLink; event: PlatformEvent; approvalId: string | null }> {
  const links = await orch.listLinks(supabase, orgId);
  const existing = links.find((l) => l.id === input.linkId);
  if (!existing) throw new HttpError(404, 'Platform link not found.', 'pm_link_not_found');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('pm_platform_links')
    .update({
      sync_status: 'synced',
      last_synced_at: now,
      last_error: null,
      metadata: { ...(existing.metadata ?? {}), lastPayload: input.payload ?? {} },
    })
    .eq('id', input.linkId)
    .select('*')
    .single();
  if (error) {
    throw new HttpError(500, `sync link: ${error.message}`, 'pm_orchestration_failed');
  }
  const link = orch.serializeLink(data);

  let approvalId: string | null = null;
  if (input.proposeAction) {
    const approval = await orch.createApproval(supabase, orgId, {
      project_id: existing.projectId,
      kind: input.proposeAction.kind,
      title: input.proposeAction.title,
      detail: input.proposeAction.detail ?? null,
      proposed_action: input.proposeAction.proposedAction,
      platform: existing.platform,
      priority: input.proposeAction.priority ?? 'normal',
      requested_by: userId,
      source_ref: existing.id,
    });
    approvalId = approval.id;
  }

  const event = await orch.recordPlatformEvent(supabase, orgId, {
    project_id: existing.projectId,
    platform: existing.platform,
    event_kind: input.proposeAction ? 'action_proposed' : 'synced',
    direction: 'inbound',
    summary: input.summary,
    detail: input.detail ?? null,
    external_id: existing.externalId,
    payload: input.payload ?? {},
    requires_approval: Boolean(approvalId),
    approval_id: approvalId,
    recorded_by: userId,
  });

  // Stamp the org connection's last_synced_at too.
  await orch.upsertConnection(supabase, orgId, {
    platform: existing.platform,
    status: 'connected',
    metadata: { lastProjectSync: existing.projectId },
  });
  await supabase
    .from('pm_platform_connections')
    .update({ last_synced_at: now })
    .eq('org_id', orgId)
    .eq('platform', existing.platform);

  return { link, event, approvalId };
}

/**
 * Decide an approval. Approving records the decision; irreversible vendor
 * writes still need their connector called by a follow-up job — we never
 * pretend a click here pushed to Xactimate by itself.
 */
export async function decideApproval(
  supabase: SupabaseClient,
  userId: string,
  input: {
    approvalId: string;
    decision: 'approved' | 'rejected';
    note?: string | null;
  },
) {
  const patch: Record<string, unknown> = {
    status: input.decision,
    decided_by: userId,
    decided_at: new Date().toISOString(),
    decision_note: input.note ?? null,
  };
  return orch.updateApproval(supabase, input.approvalId, patch);
}
