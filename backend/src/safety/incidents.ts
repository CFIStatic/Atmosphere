/**
 * Persist safety incidents + rate-limit alerts.
 * Uses Supabase when available; an in-memory store for unit tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import {
  SAFETY_ALERT_RATE_LIMIT_MS,
  type SafetyCategory,
  type SafetyClassification,
  type SafetyDismissCategory,
  type SafetyIncident,
  type SafetySeverity,
  type SafetySource,
  type SafetyStatus,
} from './types.js';

type MemoryRow = SafetyIncident;

const memory = new Map<string, MemoryRow>();

export function resetSafetyIncidentsForTests(): void {
  memory.clear();
}

function rowFromDb(r: any): SafetyIncident {
  return {
    id: r.id,
    orgId: r.org_id,
    jobId: r.job_id ?? null,
    partyId: r.party_id ?? null,
    proofId: r.proof_id ?? null,
    clipId: r.clip_id ?? null,
    category: r.category,
    severity: r.severity,
    confidence: Number(r.confidence),
    title: r.title,
    description: r.description,
    clipTimestampSeconds:
      r.clip_timestamp_seconds == null ? null : Number(r.clip_timestamp_seconds),
    lat: r.lat == null ? null : Number(r.lat),
    lon: r.lon == null ? null : Number(r.lon),
    locationLabel: r.location_label ?? null,
    recommendedAction: r.recommended_action,
    status: r.status,
    source: r.source,
    model: r.model ?? null,
    signals: (r.signals as Record<string, unknown>) ?? {},
    alertSentAt: r.alert_sent_at ?? null,
    alertChannels: Array.isArray(r.alert_channels) ? r.alert_channels : [],
    acknowledgedAt: r.acknowledged_at ?? null,
    acknowledgedBy: r.acknowledged_by ?? null,
    dismissedAt: r.dismissed_at ?? null,
    dismissedBy: r.dismissed_by ?? null,
    dismissReason: r.dismiss_reason ?? null,
    dismissCategory: r.dismiss_category ?? null,
    reality: r.reality ?? null,
    confirmation: r.confirmation ?? null,
    workerOkAt: r.worker_ok_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function useMemory(): boolean {
  return process.env.SAFETY_STORE === 'memory';
}

export type CreateIncidentInput = {
  orgId: string;
  jobId?: string | null;
  partyId?: string | null;
  proofId?: string | null;
  clipId?: string | null;
  classification: SafetyClassification;
  source: SafetySource;
  lat?: number | null;
  lon?: number | null;
  locationLabel?: string | null;
};

/**
 * True when an open incident of the same category already exists for this
 * job inside the rate-limit window — suppress duplicate alerts.
 */
export async function recentDuplicate(
  admin: any,
  input: {
    orgId: string;
    jobId?: string | null;
    category: SafetyCategory;
    withinMs?: number;
  },
): Promise<SafetyIncident | null> {
  const within = input.withinMs ?? SAFETY_ALERT_RATE_LIMIT_MS;
  const since = new Date(Date.now() - within).toISOString();

  if (useMemory()) {
    const rows = [...memory.values()]
      .filter(
        (r) =>
          r.orgId === input.orgId &&
          r.category === input.category &&
          (input.jobId ? r.jobId === input.jobId : true) &&
          r.status === 'open' &&
          r.createdAt >= since,
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows[0] ?? null;
  }

  let q = admin
    .from('safety_incidents')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('category', input.category)
    .eq('status', 'open')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (input.jobId) q = q.eq('job_id', input.jobId);
  const { data, error } = await q.maybeSingle();
  if (error) {
    // Table missing in older environments — treat as no duplicate.
    if (/safety_incidents|does not exist|42P01/i.test(error.message ?? '')) return null;
    throw new Error(error.message);
  }
  return data ? rowFromDb(data) : null;
}

export async function createSafetyIncident(
  admin: any,
  input: CreateIncidentInput,
): Promise<{
  incident: SafetyIncident;
  created: boolean;
  suppressedDuplicate: boolean;
  /** An open "unconfirmed" incident was upgraded to confirmed (re-alert). */
  upgraded?: boolean;
}> {
  const c = input.classification;
  if (!c.hit || !c.category || !c.severity || !c.title || !c.description) {
    throw new Error('Cannot create incident from a miss classification');
  }

  const dup = await recentDuplicate(admin, {
    orgId: input.orgId,
    jobId: input.jobId ?? null,
    category: c.category,
  });
  if (dup) {
    // "Unconfirmed: check live view" followed by a confirmed "real" for the
    // same job + category is news the office must get, not a duplicate.
    if (dup.confirmation === 'unconfirmed' && c.confirmation === 'confirmed') {
      const upgraded = await upgradeIncident(admin, dup, c);
      return { incident: upgraded, created: false, suppressedDuplicate: false, upgraded: true };
    }
    return { incident: dup, created: false, suppressedDuplicate: true };
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const row = {
    id,
    org_id: input.orgId,
    job_id: input.jobId ?? null,
    party_id: input.partyId ?? null,
    proof_id: input.proofId ?? null,
    clip_id: input.clipId ?? null,
    category: c.category,
    severity: c.severity,
    confidence: c.confidence,
    title: c.title.slice(0, 200),
    description: c.description.slice(0, 4000),
    clip_timestamp_seconds: c.clipTimestampSeconds,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    location_label: input.locationLabel?.slice(0, 400) ?? null,
    recommended_action: c.recommendedAction,
    status: 'open' as SafetyStatus,
    source: input.source,
    model: c.model,
    signals: c.signals ?? {},
    alert_sent_at: null,
    alert_channels: [],
    acknowledged_at: null,
    acknowledged_by: null,
    dismissed_at: null,
    dismissed_by: null,
    dismiss_reason: null,
    dismiss_category: null,
    reality: c.reality ?? null,
    confirmation: c.confirmation ?? null,
    worker_ok_at: null,
    created_at: now,
    updated_at: now,
  };

  if (useMemory()) {
    const incident = rowFromDb(row);
    memory.set(id, incident);
    return { incident, created: true, suppressedDuplicate: false };
  }

  let { data, error } = await admin.from('safety_incidents').insert(row).select('*').single();
  if (error && /reality|confirmation|dismiss_category|worker_ok_at|live_stream/.test(error.message ?? '')) {
    // Live-safety migration not applied yet: still record the incident.
    const { reality, confirmation, dismiss_category, worker_ok_at, ...legacy } = row;
    void reality; void confirmation; void dismiss_category; void worker_ok_at;
    ({ data, error } = await admin
      .from('safety_incidents')
      .insert({
        ...legacy,
        source: legacy.source === 'live_stream' ? 'live_sample' : legacy.source,
        signals: { ...(legacy.signals ?? {}), reality: row.reality, confirmation: row.confirmation },
      })
      .select('*')
      .single());
  }
  if (error) throw new Error(error.message);
  return { incident: rowFromDb(data), created: true, suppressedDuplicate: false };
}

async function upgradeIncident(
  admin: any,
  existing: SafetyIncident,
  c: SafetyClassification,
): Promise<SafetyIncident> {
  const now = new Date().toISOString();
  const patch = {
    severity: c.severity ?? existing.severity,
    confidence: c.confidence,
    title: (c.title ?? existing.title).slice(0, 200),
    description: (c.description ?? existing.description).slice(0, 4000),
    recommended_action: c.recommendedAction,
    reality: c.reality ?? 'real',
    confirmation: 'confirmed',
    model: c.model,
    signals: { ...(existing.signals ?? {}), ...(c.signals ?? {}), upgradedFromUnconfirmedAt: now },
    updated_at: now,
  };
  if (useMemory()) {
    const next: SafetyIncident = {
      ...existing,
      severity: patch.severity,
      confidence: patch.confidence,
      title: patch.title,
      description: patch.description,
      recommendedAction: patch.recommended_action,
      reality: patch.reality,
      confirmation: 'confirmed',
      model: patch.model,
      signals: patch.signals,
      updatedAt: now,
    };
    memory.set(existing.id, next);
    return next;
  }
  const { data, error } = await admin
    .from('safety_incidents')
    .update(patch)
    .eq('id', existing.id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowFromDb(data);
}

/**
 * Pages (email / SMS) already sent for this job in the last hour. Used to cap
 * alert fatigue; the incident is still recorded and shown in Platform.
 */
export async function countRecentJobAlerts(
  admin: any,
  input: { orgId: string; jobId: string | null; withinMs?: number },
): Promise<number> {
  if (!input.jobId) return 0;
  const since = new Date(Date.now() - (input.withinMs ?? 60 * 60 * 1000)).toISOString();
  if (useMemory()) {
    return [...memory.values()].filter(
      (r) =>
        r.orgId === input.orgId &&
        r.jobId === input.jobId &&
        r.alertSentAt != null &&
        r.alertSentAt >= since &&
        r.alertChannels.some((ch) => ch === 'email' || ch === 'sms' || ch === 'voice'),
    ).length;
  }
  const { data, error } = await admin
    .from('safety_incidents')
    .select('id, alert_channels')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .gte('alert_sent_at', since)
    .limit(200);
  if (error) return 0;
  return ((data ?? []) as any[]).filter(
    (r) => Array.isArray(r.alert_channels) && r.alert_channels.some((ch: string) => ch === 'email' || ch === 'sms' || ch === 'voice'),
  ).length;
}

/** Worker tapped "I'm OK" on the phone banner. Never affects whether the alert went out. */
export async function markWorkerOk(
  admin: any,
  id: string,
): Promise<SafetyIncident> {
  const now = new Date().toISOString();
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) throw Object.assign(new Error('Incident not found'), { code: 'not_found' });
    const next: SafetyIncident = { ...row, workerOkAt: row.workerOkAt ?? now, updatedAt: now };
    memory.set(id, next);
    return next;
  }
  const { data, error } = await admin
    .from('safety_incidents')
    .update({ worker_ok_at: now, updated_at: now })
    .eq('id', id)
    .is('worker_ok_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return rowFromDb(data);
  const existing = await getSafetyIncident(admin, id);
  if (!existing) throw Object.assign(new Error('Incident not found'), { code: 'not_found' });
  return existing;
}

/** Add a channel (sms / voice) after the first fanout. */
export async function appendIncidentChannel(admin: any, id: string, channel: string): Promise<void> {
  const current = await getSafetyIncident(admin, id);
  if (!current || current.alertChannels.includes(channel)) return;
  await markIncidentAlerted(admin, id, [...current.alertChannels, channel]);
}

export async function listSafetyIncidents(
  admin: any,
  opts: {
    orgId?: string;
    jobId?: string;
    status?: SafetyStatus | 'all';
    severity?: SafetySeverity;
    limit?: number;
  },
): Promise<SafetyIncident[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));

  if (useMemory()) {
    return [...memory.values()]
      .filter((r) => {
        if (opts.orgId && r.orgId !== opts.orgId) return false;
        if (opts.jobId && r.jobId !== opts.jobId) return false;
        if (opts.status && opts.status !== 'all' && r.status !== opts.status) return false;
        if (opts.severity && r.severity !== opts.severity) return false;
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }

  let q = admin.from('safety_incidents').select('*').order('created_at', { ascending: false }).limit(limit);
  if (opts.orgId) q = q.eq('org_id', opts.orgId);
  if (opts.jobId) q = q.eq('job_id', opts.jobId);
  if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
  if (opts.severity) q = q.eq('severity', opts.severity);
  const { data, error } = await q;
  if (error) {
    if (/safety_incidents|does not exist|42P01/i.test(error.message ?? '')) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as any[]).map(rowFromDb);
}

export async function getSafetyIncident(
  admin: any,
  id: string,
): Promise<SafetyIncident | null> {
  if (useMemory()) return memory.get(id) ?? null;
  const { data, error } = await admin.from('safety_incidents').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (/safety_incidents|does not exist|42P01/i.test(error.message ?? '')) return null;
    throw new Error(error.message);
  }
  return data ? rowFromDb(data) : null;
}

export async function acknowledgeSafetyIncident(
  admin: any,
  id: string,
  actorUserId: string | null,
): Promise<SafetyIncident> {
  const now = new Date().toISOString();
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) throw Object.assign(new Error('Incident not found'), { code: 'not_found' });
    const next: SafetyIncident = {
      ...row,
      status: 'acknowledged',
      acknowledgedAt: now,
      acknowledgedBy: actorUserId,
      updatedAt: now,
    };
    memory.set(id, next);
    return next;
  }
  const { data, error } = await admin
    .from('safety_incidents')
    .update({
      status: 'acknowledged',
      acknowledged_at: now,
      acknowledged_by: actorUserId,
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowFromDb(data);
}

export async function dismissSafetyIncident(
  admin: any,
  id: string,
  actorUserId: string | null,
  reason?: string | null,
  category?: SafetyDismissCategory | null,
): Promise<SafetyIncident> {
  const now = new Date().toISOString();
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) throw Object.assign(new Error('Incident not found'), { code: 'not_found' });
    const next: SafetyIncident = {
      ...row,
      status: 'dismissed',
      dismissedAt: now,
      dismissedBy: actorUserId,
      dismissReason: reason?.slice(0, 1000) ?? null,
      dismissCategory: category ?? null,
      updatedAt: now,
    };
    memory.set(id, next);
    return next;
  }
  const { data, error } = await admin
    .from('safety_incidents')
    .update({
      status: 'dismissed',
      dismissed_at: now,
      dismissed_by: actorUserId,
      dismiss_reason: reason?.slice(0, 1000) ?? null,
      ...(category ? { dismiss_category: category } : {}),
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowFromDb(data);
}

export async function markIncidentAlerted(
  admin: any,
  id: string,
  channels: string[],
): Promise<void> {
  const now = new Date().toISOString();
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) return;
    memory.set(id, {
      ...row,
      alertSentAt: now,
      alertChannels: channels,
      updatedAt: now,
    });
    return;
  }
  await admin
    .from('safety_incidents')
    .update({ alert_sent_at: now, alert_channels: channels, updated_at: now })
    .eq('id', id);
}
