/**
 * Adaptive internal communication — Atmosphere opens a thread when the
 * situation needs a conversation, and keeps quiet otherwise.
 *
 * Modes:
 *   live   — active coordination (critical alerts, pending high approvals)
 *   digest — batched updates (invites, routine procurement)
 *   muted  — parked; still searchable, not noisy
 *
 * Origin keys make opening idempotent: the same approval does not spawn a
 * second thread on every engine pass.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSnapshot } from '../types.js';
import * as net from './networkStore.js';
import type {
  Thread,
  ThreadAdaptation,
  ThreadKind,
  ThreadMode,
} from './networkTypes.js';

export async function createThread(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: {
    kind: ThreadKind;
    mode: ThreadMode;
    title: string;
    urgency: Thread['urgency'];
    originKey?: string | null;
    originRef?: string | null;
    projectId?: string | null;
    partnershipId?: string | null;
    seedMessage?: string;
    participantUserIds?: string[];
  },
): Promise<Thread> {
  if (input.originKey) {
    const existing = await net.getThreadByOrigin(supabase, orgId, input.originKey);
    if (existing) return existing;
  }

  const thread = await net.createThread(supabase, orgId, {
    project_id: input.projectId ?? null,
    partnership_id: input.partnershipId ?? null,
    kind: input.kind,
    mode: input.mode,
    title: input.title,
    status: 'open',
    origin_key: input.originKey ?? null,
    origin_ref: input.originRef ?? null,
    urgency: input.urgency,
    created_by: userId,
  });

  if (userId) {
    await net.addParticipant(supabase, orgId, {
      thread_id: thread.id,
      user_id: userId,
      role_in_thread: 'owner',
    });
  }

  for (const uid of input.participantUserIds ?? []) {
    if (uid === userId) continue;
    await net.addParticipant(supabase, orgId, {
      thread_id: thread.id,
      user_id: uid,
      role_in_thread: 'member',
    });
  }

  if (input.seedMessage) {
    await net.postMessage(supabase, orgId, {
      thread_id: thread.id,
      author_user_id: null,
      author_kind: 'atmosphere',
      body: input.seedMessage,
      payload: { adaptive: true, originKey: input.originKey ?? null },
    });
  }

  return thread;
}

export async function ensureAdaptationApplied(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  adaptation: ThreadAdaptation,
): Promise<Thread | null> {
  if (adaptation.action === 'skip') return null;

  const existing = await net.getThreadByOrigin(supabase, orgId, adaptation.originKey);

  if (adaptation.action === 'open') {
    return createThread(supabase, orgId, userId, {
      kind: adaptation.kind,
      mode: adaptation.mode,
      title: adaptation.title,
      urgency: adaptation.urgency,
      originKey: adaptation.originKey,
      projectId: adaptation.projectId,
      partnershipId: adaptation.partnershipId,
      seedMessage: adaptation.seedMessage ?? adaptation.reason,
    });
  }

  if (!existing) {
    if (adaptation.action === 'resolve') return null;
    return createThread(supabase, orgId, userId, {
      kind: adaptation.kind,
      mode: adaptation.mode,
      title: adaptation.title,
      urgency: adaptation.urgency,
      originKey: adaptation.originKey,
      projectId: adaptation.projectId,
      partnershipId: adaptation.partnershipId,
      seedMessage: adaptation.seedMessage ?? adaptation.reason,
    });
  }

  if (adaptation.action === 'promote' || adaptation.action === 'demote') {
    const updated = await net.updateThread(supabase, existing.id, {
      mode: adaptation.mode,
      urgency: adaptation.urgency,
    });
    await net.postMessage(supabase, orgId, {
      thread_id: existing.id,
      author_kind: 'atmosphere',
      author_user_id: null,
      body: adaptation.reason,
      payload: { adaptive: true, action: adaptation.action, mode: adaptation.mode },
    });
    return updated;
  }

  if (adaptation.action === 'resolve' && existing.status === 'open') {
    return net.updateThread(supabase, existing.id, {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      mode: 'muted',
    });
  }

  return existing;
}

/**
 * Pure decisions over the org snapshot — what conversations should exist.
 *
 * Kept free of DB writes so it can run inside the engine pass and in tests.
 */
export function proposeThreadAdaptations(snapshot: OrgSnapshot): ThreadAdaptation[] {
  const out: ThreadAdaptation[] = [];

  for (const approval of snapshot.pendingApprovals) {
    if (approval.priority === 'high' || approval.priority === 'urgent') {
      out.push({
        action: 'open',
        kind: 'approval_followup',
        mode: 'live',
        urgency: approval.priority === 'urgent' ? 'urgent' : 'high',
        title: `Approval · ${approval.title}`,
        originKey: `thread:approval:${approval.id}`,
        reason: `A ${approval.priority} approval is waiting. Use this thread for nuance before you decide.`,
        projectId: approval.projectId,
        seedMessage: approval.detail || approval.title,
      });
    }
  }

  for (const ctx of snapshot.projects) {
    const critical = ctx.communications.filter((c) => c.status === 'new').length;
    const openProcurement = ctx.procurement.filter(
      (p) => p.status === 'bidding' || p.status === 'awaiting_approval',
    );

    if (critical >= 2) {
      out.push({
        action: 'open',
        kind: 'project_ops',
        mode: 'live',
        urgency: 'high',
        title: `${ctx.project.projectNumber} · message traffic`,
        originKey: `thread:comms:${ctx.project.id}`,
        reason: `${critical} unreviewed external messages — coordinate the reply here.`,
        projectId: ctx.project.id,
      });
    }

    if (openProcurement.length) {
      out.push({
        action: 'open',
        kind: 'procurement',
        mode: openProcurement.some((p) => p.status === 'awaiting_approval') ? 'live' : 'digest',
        urgency: 'normal',
        title: `${ctx.project.projectNumber} · procurement`,
        originKey: `thread:procurement:${ctx.project.id}`,
        reason: `${openProcurement.length} open procurement item(s). Compare bids and referral orders here.`,
        projectId: ctx.project.id,
      });
    }

    const vendorComms = ctx.communications.filter(
      (c) =>
        c.status === 'new' &&
        (c.counterpartyKind === 'vendor' ||
          c.counterpartyKind === 'supplier' ||
          (c as { counterpartyKind: string }).counterpartyKind === 'subcontractor'),
    );
    if (vendorComms.length) {
      out.push({
        action: 'open',
        kind: 'vendor_coordination',
        mode: 'live',
        urgency: 'high',
        title: `${ctx.project.projectNumber} · vendor / sub`,
        originKey: `thread:vendor:${ctx.project.id}`,
        reason: 'Vendor or subcontractor traffic needs an on-platform reply.',
        projectId: ctx.project.id,
      });
    }
  }

  return out;
}

/** Apply adaptations after an engine pass (best-effort; schema may be missing). */
export async function applyThreadAdaptations(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  snapshot: OrgSnapshot,
): Promise<{ opened: number; adjusted: number }> {
  const proposals = proposeThreadAdaptations(snapshot);
  let opened = 0;
  let adjusted = 0;
  for (const proposal of proposals) {
    try {
      const before = proposal.originKey
        ? await net.getThreadByOrigin(supabase, orgId, proposal.originKey)
        : null;
      const result = await ensureAdaptationApplied(supabase, orgId, userId, proposal);
      if (!result) continue;
      if (!before) opened += 1;
      else if (proposal.action === 'promote' || proposal.action === 'demote') adjusted += 1;
    } catch (err) {
      if ((err as { code?: string })?.code === 'pm_network_schema_missing') break;
      // Non-fatal: a failed thread open must not take down the engine pass.
    }
  }
  return { opened, adjusted };
}
