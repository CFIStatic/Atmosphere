/**
 * Situation awareness — one timeline of what is happening across platforms,
 * messaging, approvals and procurement so a PM can see the whole board.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as pmStore from '../store.js';
import * as orch from './store.js';
import type { SituationEvent } from './types.js';

export async function buildSituation(
  supabase: SupabaseClient,
  orgId: string,
  options: { projectId?: string; limit?: number } = {},
): Promise<{
  events: SituationEvent[];
  counts: {
    pendingApprovals: number;
    unreviewedComms: number;
    openProcurement: number;
    staleLinks: number;
    openAlerts: number;
  };
}> {
  const limit = options.limit ?? 80;
  const projectId = options.projectId;

  const [alerts, communications, platformEvents, approvals, procurement, links] =
    await Promise.all([
      pmStore.listAlerts(supabase, orgId, {
        projectId,
        statuses: ['open', 'acknowledged'],
        limit: 100,
      }),
      orch.listCommunications(supabase, orgId, {
        projectId,
        status: ['new', 'reviewed'],
        limit: 100,
      }),
      orch.listPlatformEvents(supabase, orgId, { projectId, limit: 100 }),
      orch.listApprovals(supabase, orgId, {
        projectId,
        status: ['pending'],
        limit: 100,
      }),
      orch.listProcurement(supabase, orgId, {
        projectId,
        status: ['open', 'bidding', 'awaiting_approval'],
        limit: 100,
      }),
      orch.listLinks(supabase, orgId, { projectId }),
    ]);

  const events: SituationEvent[] = [];

  for (const a of alerts) {
    events.push({
      id: `alert:${a.id}`,
      kind: 'alert',
      projectId: a.projectId,
      occurredAt: a.lastSeenAt,
      title: a.title,
      detail: a.suggestedAction ?? a.detail,
      severity: a.severity,
      status: a.status,
    });
  }

  for (const c of communications) {
    events.push({
      id: `comm:${c.id}`,
      kind: 'communication',
      projectId: c.projectId,
      occurredAt: c.occurredAt,
      title: `${c.channel} · ${c.counterpartyName || c.counterpartyHandle || 'unknown'}`,
      detail: c.mentionExcerpt || c.body.slice(0, 240),
      severity: c.status === 'new' ? 'warn' : 'info',
      status: c.status,
    });
  }

  for (const e of platformEvents) {
    events.push({
      id: `plat:${e.id}`,
      kind: 'platform',
      projectId: e.projectId,
      occurredAt: e.occurredAt,
      title: `${e.platform}: ${e.summary}`,
      detail: e.detail,
      severity: e.requiresApproval ? 'warn' : 'info',
      status: e.eventKind,
    });
  }

  for (const a of approvals) {
    events.push({
      id: `appr:${a.id}`,
      kind: 'approval',
      projectId: a.projectId,
      occurredAt: a.createdAt,
      title: a.title,
      detail: a.detail,
      severity: a.priority === 'urgent' || a.priority === 'high' ? 'critical' : 'warn',
      status: a.status,
    });
  }

  for (const p of procurement) {
    events.push({
      id: `proc:${p.id}`,
      kind: 'procurement',
      projectId: p.projectId,
      occurredAt: p.updatedAt,
      title: p.title,
      detail: p.referralUrl || p.description,
      severity: p.status === 'awaiting_approval' ? 'warn' : 'info',
      status: p.status,
    });
  }

  events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  const staleCutoff = Date.now() - 3 * 86_400_000;
  const staleLinks = links.filter((l) => {
    if (l.syncStatus === 'stale' || l.syncStatus === 'error') return true;
    if (!l.lastSyncedAt) return l.syncStatus === 'linked';
    return new Date(l.lastSyncedAt).getTime() < staleCutoff;
  }).length;

  return {
    events: events.slice(0, limit),
    counts: {
      pendingApprovals: approvals.length,
      unreviewedComms: communications.filter((c) => c.status === 'new').length,
      openProcurement: procurement.length,
      staleLinks,
      openAlerts: alerts.filter((a) => a.status === 'open').length,
    },
  };
}
