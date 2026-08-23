/**
 * In-process legal store with optional Supabase persistence.
 *
 * Tests set LEGAL_STORE=memory. Production writes through the service role
 * so customers never see these rows over RLS.
 */
import { randomUUID } from 'node:crypto';
import { adminOrNull, requireAdmin, useMemoryLegalStore } from '../lib/adminClient.js';
import { HttpError } from '../lib/errors.js';
import { preparePayload } from '../lib/auditLog.js';
import type {
  CreateHoldInput,
  LegalHold,
  LegalHoldRecord,
  LegalHoldSubject,
  LegalProduction,
  LegalVaultEntry,
  RecordActivityInput,
  UserActivityEvent,
  VaultMediaInput,
} from './types.js';

const holds = new Map<string, LegalHold>();
const subjects = new Map<string, LegalHoldSubject[]>();
const vault = new Map<string, LegalVaultEntry>();
const vaultBySource = new Map<string, string>();
const activity = new Map<string, UserActivityEvent>();
const productions = new Map<string, LegalProduction>();

export function resetLegalStoreForTests(): void {
  holds.clear();
  subjects.clear();
  vault.clear();
  vaultBySource.clear();
  activity.clear();
  productions.clear();
}

function sourceKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function holdFromRow(r: Record<string, unknown>): LegalHold {
  return {
    id: String(r.id),
    caseNumber: String(r.case_number),
    kind: r.kind as LegalHold['kind'],
    title: String(r.title),
    reason: String(r.reason),
    counselName: (r.counsel_name as string) ?? null,
    receivedAt: String(r.received_at),
    dueAt: (r.due_at as string) ?? null,
    status: r.status as LegalHold['status'],
    origin: (r.origin as LegalHold['origin']) ?? 'staff',
    autoRule: (r.auto_rule as string) ?? null,
    reviewBy: (r.review_by as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: String(r.created_at),
    releasedBy: (r.released_by as string) ?? null,
    releasedAt: (r.released_at as string) ?? null,
    releaseReason: (r.release_reason as string) ?? null,
  };
}

function subjectFromRow(r: Record<string, unknown>): LegalHoldSubject {
  return {
    id: String(r.id),
    holdId: String(r.hold_id),
    subjectType: r.subject_type as LegalHoldSubject['subjectType'],
    subjectId: String(r.subject_id),
    createdAt: String(r.created_at),
  };
}

function vaultFromRow(r: Record<string, unknown>): LegalVaultEntry {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    sourceKind: r.source_kind as LegalVaultEntry['sourceKind'],
    sourceId: String(r.source_id),
    jobId: (r.job_id as string) ?? null,
    actorUserId: (r.actor_user_id as string) ?? null,
    storageBackend: String(r.storage_backend),
    storageBucket: String(r.storage_bucket),
    storageKey: String(r.storage_key),
    contentHash: (r.content_hash as string) ?? null,
    byteSize: r.byte_size != null ? Number(r.byte_size) : null,
    durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
    contentType: (r.content_type as string) ?? null,
    capturedAt: (r.captured_at as string) ?? null,
    receivedAt: String(r.received_at),
    userDeletedAt: (r.user_deleted_at as string) ?? null,
    vaultedAt: String(r.vaulted_at),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

function activityFromRow(r: Record<string, unknown>): UserActivityEvent {
  return {
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    actorUserId: (r.actor_user_id as string) ?? null,
    actorEmail: (r.actor_email as string) ?? null,
    actorLabel: (r.actor_label as string) ?? null,
    orgId: (r.org_id as string) ?? null,
    action: String(r.action),
    resourceType: (r.resource_type as string) ?? null,
    resourceId: r.resource_id != null ? String(r.resource_id) : null,
    requestId: (r.request_id as string) ?? null,
    method: (r.method as string) ?? null,
    path: (r.path as string) ?? null,
    status: r.status != null ? Number(r.status) : null,
    ip: (r.ip as string) ?? null,
    userAgent: (r.user_agent as string) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? {},
  };
}

function productionFromRow(r: Record<string, unknown>): LegalProduction {
  return {
    id: String(r.id),
    holdId: String(r.hold_id),
    requestedBy: (r.requested_by as string) ?? null,
    createdAt: String(r.created_at),
    itemCount: Number(r.item_count ?? 0),
    activityCount: Number(r.activity_count ?? 0),
    note: (r.note as string) ?? null,
  };
}

export async function persistHold(record: LegalHoldRecord): Promise<void> {
  if (useMemoryLegalStore()) return;
  const admin = requireAdmin();
  const { error: holdError } = await admin.from('legal_holds').insert({
    id: record.id,
    case_number: record.caseNumber,
    kind: record.kind,
    title: record.title,
    reason: record.reason,
    counsel_name: record.counselName,
    received_at: record.receivedAt,
    due_at: record.dueAt,
    status: record.status,
    origin: record.origin,
    auto_rule: record.autoRule,
    review_by: record.reviewBy,
    created_by: record.createdBy,
    created_at: record.createdAt,
    released_by: record.releasedBy,
    released_at: record.releasedAt,
    release_reason: record.releaseReason,
  });
  if (holdError) {
    if (/does not exist|42P01/i.test(holdError.message)) return;
    throw new HttpError(502, holdError.message, 'legal_hold_persist_failed');
  }
  if (record.subjects.length) {
    const { error } = await admin.from('legal_hold_subjects').insert(
      record.subjects.map((subject) => ({
        id: subject.id,
        hold_id: subject.holdId,
        subject_type: subject.subjectType,
        subject_id: subject.subjectId,
        created_at: subject.createdAt,
      })),
    );
    if (error && !/does not exist|42P01/i.test(error.message)) {
      throw new HttpError(502, error.message, 'legal_subject_persist_failed');
    }
  }
}

export async function persistHoldRelease(hold: LegalHold): Promise<void> {
  if (useMemoryLegalStore()) return;
  const admin = requireAdmin();
  const { error } = await admin
    .from('legal_holds')
    .update({
      status: hold.status,
      released_by: hold.releasedBy,
      released_at: hold.releasedAt,
      release_reason: hold.releaseReason,
    })
    .eq('id', hold.id);
  if (error && !/does not exist|42P01/i.test(error.message)) {
    throw new HttpError(502, error.message, 'legal_hold_release_failed');
  }
}

export async function persistVault(entry: LegalVaultEntry): Promise<void> {
  if (useMemoryLegalStore()) return;
  const admin = adminOrNull();
  if (!admin) return;
  const { error } = await admin.from('legal_video_vault').upsert(
    {
      id: entry.id,
      org_id: entry.orgId,
      source_kind: entry.sourceKind,
      source_id: entry.sourceId,
      job_id: entry.jobId,
      actor_user_id: entry.actorUserId,
      storage_backend: entry.storageBackend,
      storage_bucket: entry.storageBucket,
      storage_key: entry.storageKey,
      content_hash: entry.contentHash,
      byte_size: entry.byteSize,
      duration_seconds: entry.durationSeconds,
      content_type: entry.contentType,
      captured_at: entry.capturedAt,
      received_at: entry.receivedAt,
      user_deleted_at: entry.userDeletedAt,
      vaulted_at: entry.vaultedAt,
      metadata: entry.metadata,
    },
    { onConflict: 'source_kind,source_id' },
  );
  if (error && !/does not exist|42P01/i.test(error.message)) {
    throw new HttpError(502, error.message, 'legal_vault_persist_failed');
  }
}

export async function persistActivity(event: UserActivityEvent): Promise<void> {
  if (useMemoryLegalStore()) return;
  const admin = adminOrNull();
  if (!admin) return;
  const { error } = await admin.from('user_activity_events').insert({
    id: event.id,
    occurred_at: event.occurredAt,
    actor_user_id: event.actorUserId,
    actor_email: event.actorEmail,
    actor_label: event.actorLabel,
    org_id: event.orgId,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    request_id: event.requestId,
    method: event.method,
    path: event.path,
    status: event.status,
    ip: event.ip,
    user_agent: event.userAgent,
    detail: event.detail,
  });
  if (error && !/does not exist|42P01/i.test(error.message)) {
    console.warn('[legal] activity persist failed:', error.message);
  }
}

export async function persistProduction(row: LegalProduction): Promise<void> {
  if (useMemoryLegalStore()) return;
  const admin = requireAdmin();
  const { error } = await admin.from('legal_productions').insert({
    id: row.id,
    hold_id: row.holdId,
    requested_by: row.requestedBy,
    created_at: row.createdAt,
    item_count: row.itemCount,
    activity_count: row.activityCount,
    note: row.note,
  });
  if (error && !/does not exist|42P01/i.test(error.message)) {
    throw new HttpError(502, error.message, 'legal_production_persist_failed');
  }
}

export function rememberHold(record: LegalHoldRecord): void {
  holds.set(record.id, record);
  subjects.set(record.id, record.subjects);
}

export function rememberVault(entry: LegalVaultEntry): void {
  vault.set(entry.id, entry);
  vaultBySource.set(sourceKey(entry.sourceKind, entry.sourceId), entry.id);
}

export function rememberActivity(event: UserActivityEvent): void {
  activity.set(event.id, event);
}

export function rememberProduction(row: LegalProduction): void {
  productions.set(row.id, row);
}

export function createHoldRecord(input: CreateHoldInput): LegalHoldRecord {
  const now = new Date().toISOString();
  const holdId = randomUUID();
  const record: LegalHoldRecord = {
    id: holdId,
    caseNumber: input.caseNumber.trim(),
    kind: input.kind,
    title: input.title.trim(),
    reason: input.reason.trim(),
    counselName: input.counselName?.trim() || null,
    receivedAt: input.receivedAt ?? now,
    dueAt: input.dueAt ?? null,
    status: 'open',
    origin: input.origin ?? 'staff',
    autoRule: input.autoRule ?? null,
    reviewBy: input.reviewBy ?? null,
    createdBy: input.createdBy ?? null,
    createdAt: now,
    releasedBy: null,
    releasedAt: null,
    releaseReason: null,
    subjects: input.subjects.map((subject) => ({
      id: randomUUID(),
      holdId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      createdAt: now,
    })),
  };
  rememberHold(record);
  return record;
}

export function listHoldsFromMemory(): LegalHoldRecord[] {
  return [...holds.values()]
    .map((hold) => ({ ...hold, subjects: subjects.get(hold.id) ?? [] }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getHoldFromMemory(id: string): LegalHoldRecord | null {
  const hold = holds.get(id);
  if (!hold) return null;
  return { ...hold, subjects: subjects.get(id) ?? [] };
}

export function releaseHoldInMemory(
  id: string,
  input: { releasedBy?: string | null; reason: string },
): LegalHoldRecord {
  const record = getHoldFromMemory(id);
  if (!record) throw new HttpError(404, 'Legal hold not found', 'legal_hold_not_found');
  if (record.status === 'released') {
    throw new HttpError(409, 'This hold is already released', 'legal_hold_released');
  }
  record.status = 'released';
  record.releasedBy = input.releasedBy ?? null;
  record.releasedAt = new Date().toISOString();
  record.releaseReason = input.reason;
  rememberHold(record);
  return record;
}

export function createVaultEntry(input: VaultMediaInput): LegalVaultEntry {
  const existingId = vaultBySource.get(sourceKey(input.sourceKind, input.sourceId));
  if (existingId) {
    const existing = vault.get(existingId);
    if (existing) return existing;
  }
  const now = input.receivedAt ?? new Date().toISOString();
  const entry: LegalVaultEntry = {
    id: randomUUID(),
    orgId: input.orgId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    jobId: input.jobId ?? null,
    actorUserId: input.actorUserId ?? null,
    storageBackend: input.storageBackend,
    storageBucket: input.storageBucket,
    storageKey: input.storageKey,
    contentHash: input.contentHash ?? null,
    byteSize: input.byteSize ?? null,
    durationSeconds: input.durationSeconds ?? null,
    contentType: input.contentType ?? null,
    capturedAt: input.capturedAt ?? null,
    receivedAt: now,
    userDeletedAt: null,
    vaultedAt: now,
    metadata: input.metadata ?? {},
  };
  rememberVault(entry);
  return entry;
}

export function markVaultDeleted(
  sourceKind: LegalVaultEntry['sourceKind'],
  sourceId: string,
  at = new Date().toISOString(),
): LegalVaultEntry | null {
  const id = vaultBySource.get(sourceKey(sourceKind, sourceId));
  if (!id) return null;
  const entry = vault.get(id);
  if (!entry) return null;
  entry.userDeletedAt = at;
  rememberVault(entry);
  return entry;
}

export function getVaultById(id: string): LegalVaultEntry | null {
  return vault.get(id) ?? null;
}

export function getVaultBySource(
  sourceKind: LegalVaultEntry['sourceKind'],
  sourceId: string,
): LegalVaultEntry | null {
  const id = vaultBySource.get(sourceKey(sourceKind, sourceId));
  return id ? vault.get(id) ?? null : null;
}

export function listVaultFromMemory(): LegalVaultEntry[] {
  return [...vault.values()].sort((a, b) => b.vaultedAt.localeCompare(a.vaultedAt));
}

export function createActivityEvent(input: RecordActivityInput): UserActivityEvent {
  const detail = (preparePayload(input.detail ?? {}) as Record<string, unknown>) ?? {};
  const event: UserActivityEvent = {
    id: randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    actorLabel: input.actorLabel ?? null,
    orgId: input.orgId ?? null,
    action: input.action.slice(0, 120),
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    requestId: input.requestId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    status: input.status ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    detail,
  };
  rememberActivity(event);
  return event;
}

export function listActivityFromMemory(): UserActivityEvent[] {
  return [...activity.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function createProductionRecord(input: {
  holdId: string;
  requestedBy?: string | null;
  itemCount: number;
  activityCount: number;
  note?: string | null;
}): LegalProduction {
  const row: LegalProduction = {
    id: randomUUID(),
    holdId: input.holdId,
    requestedBy: input.requestedBy ?? null,
    createdAt: new Date().toISOString(),
    itemCount: input.itemCount,
    activityCount: input.activityCount,
    note: input.note ?? null,
  };
  rememberProduction(row);
  return row;
}

export function listProductionsFromMemory(holdId: string): LegalProduction[] {
  return [...productions.values()]
    .filter((row) => row.holdId === holdId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadHold(id: string): Promise<LegalHoldRecord | null> {
  const cached = getHoldFromMemory(id);
  if (cached) return cached;
  if (useMemoryLegalStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.from('legal_holds').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  const { data: subjectRows } = await admin.from('legal_hold_subjects').select('*').eq('hold_id', id);
  const record: LegalHoldRecord = {
    ...holdFromRow(data as Record<string, unknown>),
    subjects: (subjectRows ?? []).map((row) => subjectFromRow(row as Record<string, unknown>)),
  };
  rememberHold(record);
  return record;
}

export async function loadHolds(): Promise<LegalHoldRecord[]> {
  if (!useMemoryLegalStore()) {
    const admin = adminOrNull();
    if (admin) {
      const { data } = await admin.from('legal_holds').select('*').order('created_at', { ascending: false }).limit(200);
      const { data: subjectRows } = await admin.from('legal_hold_subjects').select('*');
      const byHold = new Map<string, LegalHoldSubject[]>();
      for (const row of subjectRows ?? []) {
        const subject = subjectFromRow(row as Record<string, unknown>);
        const list = byHold.get(subject.holdId) ?? [];
        list.push(subject);
        byHold.set(subject.holdId, list);
      }
      for (const row of data ?? []) {
        const hold = holdFromRow(row as Record<string, unknown>);
        rememberHold({ ...hold, subjects: byHold.get(hold.id) ?? [] });
      }
    }
  }
  return listHoldsFromMemory();
}

export async function loadVaultById(id: string): Promise<LegalVaultEntry | null> {
  const cached = getVaultById(id);
  if (cached) return cached;
  if (useMemoryLegalStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data } = await admin.from('legal_video_vault').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const entry = vaultFromRow(data as Record<string, unknown>);
  rememberVault(entry);
  return entry;
}

export async function loadVault(): Promise<LegalVaultEntry[]> {
  if (!useMemoryLegalStore()) {
    const admin = adminOrNull();
    if (admin) {
      const { data } = await admin
        .from('legal_video_vault')
        .select('*')
        .order('vaulted_at', { ascending: false })
        .limit(2000);
      for (const row of data ?? []) rememberVault(vaultFromRow(row as Record<string, unknown>));
    }
  }
  return listVaultFromMemory();
}

export async function loadActivity(): Promise<UserActivityEvent[]> {
  if (!useMemoryLegalStore()) {
    const admin = adminOrNull();
    if (admin) {
      const { data } = await admin
        .from('user_activity_events')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(5000);
      for (const row of data ?? []) rememberActivity(activityFromRow(row as Record<string, unknown>));
    }
  }
  return listActivityFromMemory();
}

export { holdFromRow, subjectFromRow, vaultFromRow, activityFromRow, productionFromRow };
