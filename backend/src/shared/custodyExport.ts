/**
 * Custody metadata as a first-class export.
 *
 * For every clip: who filmed, when, the job id, device/phone identity when
 * the phone sent it, and upload integrity (hash + checks). This is the
 * world-model record a GC hands counsel — not a screenshot of chrome.
 *
 * Schema is versioned so a file from 2026 still parses in 2028.
 */

import { integrityOf, labelForCheck, type StoredCheck } from '../verifier/library.js';
import { parseDeviceMetadata, type DeviceIdentity } from './deviceIdentity.js';

export { parseDeviceMetadata, type DeviceIdentity } from './deviceIdentity.js';

export const CLIP_CUSTODY_SCHEMA = 'atmosphere.clip_custody.v1' as const;
export const JOB_CUSTODY_SCHEMA = 'atmosphere.job_custody.v1' as const;

export interface FilmedBy {
  partyId: string | null;
  company: string | null;
  person: string | null;
}

export interface CustodyIntegrity {
  algorithm: 'sha256';
  contentHash: string | null;
  verdict: 'pass' | 'fail' | 'unknown';
  checks: Array<{
    key: string | null;
    verdict: string;
    what: string;
    detail: string;
  }>;
}

export interface CustodyLogEntry {
  action: string;
  by: string;
  role: string | null;
  detail: string | null;
  at: string;
}

export interface ClipCustodyExport {
  schema: typeof CLIP_CUSTODY_SCHEMA;
  exportedAt: string;
  job: {
    id: string;
    number: number | null;
    name: string | null;
  };
  clip: {
    id: string;
    phase: string;
    workDate: string | null;
    filmedBy: FilmedBy;
    filmedAt: string | null;
    receivedAt: string | null;
    device: DeviceIdentity | null;
    integrity: CustodyIntegrity;
    location: { lat: number; lon: number; accuracyM: number | null } | null;
    durationSeconds: number | null;
    byteSize: number | null;
  };
  chainOfCustody: CustodyLogEntry[];
}

export interface JobCustodyExport {
  schema: typeof JOB_CUSTODY_SCHEMA;
  exportedAt: string;
  job: ClipCustodyExport['job'];
  clips: ClipCustodyExport[];
}

function clean(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed || null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function checksOf(raw: unknown): StoredCheck[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredCheck[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const verdict = rec.verdict;
    if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'unknown') continue;
    out.push({
      key: typeof rec.key === 'string' ? rec.key : String(rec.what ?? 'check'),
      verdict,
      detail: typeof rec.detail === 'string' ? rec.detail : '',
    });
  }
  return out;
}

export function buildIntegrity(input: {
  contentHash?: string | null;
  checks?: unknown;
}): CustodyIntegrity {
  const stored = checksOf(input.checks);
  return {
    algorithm: 'sha256',
    contentHash: clean(input.contentHash, 64),
    verdict: integrityOf(stored),
    checks: stored.map((c) => ({
      key: typeof c.key === 'string' ? c.key : null,
      verdict: c.verdict,
      what: labelForCheck(c.key),
      detail: c.detail,
    })),
  };
}

export function buildClipCustodyExport(input: {
  exportedAt?: string;
  job: { id: string; number?: number | null; name?: string | null };
  proof: {
    id: string;
    phase?: string | null;
    workDate?: string | null;
    work_date?: string | null;
    partyId?: string | null;
    party_id?: string | null;
    company?: string | null;
    person?: string | null;
    capturedAt?: string | null;
    captured_at?: string | null;
    receivedAt?: string | null;
    received_at?: string | null;
    contentHash?: string | null;
    content_hash?: string | null;
    checks?: unknown;
    device?: unknown;
    device_metadata?: unknown;
    lat?: number | null;
    lon?: number | null;
    accuracyM?: number | null;
    accuracy_m?: number | null;
    durationSeconds?: number | null;
    duration_seconds?: number | null;
    byteSize?: number | null;
    byte_size?: number | null;
    gps?: { lat?: number; lon?: number; accuracyM?: number | null } | null;
  };
  chainOfCustody?: Array<{
    action?: string;
    by?: string;
    actor_label?: string;
    role?: string | null;
    actor_role?: string | null;
    detail?: string | null;
    at?: string;
    occurred_at?: string;
  }>;
}): ClipCustodyExport {
  const p = input.proof;
  const lat = asNumber(p.gps?.lat ?? p.lat);
  const lon = asNumber(p.gps?.lon ?? p.lon);
  const accuracyM = asNumber(p.gps?.accuracyM ?? p.accuracyM ?? p.accuracy_m);
  return {
    schema: CLIP_CUSTODY_SCHEMA,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    job: {
      id: input.job.id,
      number: input.job.number ?? null,
      name: input.job.name ?? null,
    },
    clip: {
      id: p.id,
      phase: String(p.phase || 'unknown'),
      workDate: p.workDate ?? p.work_date ?? null,
      filmedBy: {
        partyId: p.partyId ?? p.party_id ?? null,
        company: p.company ?? null,
        person: p.person ?? null,
      },
      filmedAt: p.capturedAt ?? p.captured_at ?? null,
      receivedAt: p.receivedAt ?? p.received_at ?? null,
      device: parseDeviceMetadata(p.device ?? p.device_metadata),
      integrity: buildIntegrity({
        contentHash: p.contentHash ?? p.content_hash,
        checks: p.checks,
      }),
      location: lat != null && lon != null ? { lat, lon, accuracyM } : null,
      durationSeconds: asNumber(p.durationSeconds ?? p.duration_seconds),
      byteSize: asNumber(p.byteSize ?? p.byte_size),
    },
    chainOfCustody: (input.chainOfCustody ?? []).map((row) => ({
      action: String(row.action || 'viewed'),
      by: String(row.by || row.actor_label || 'unknown'),
      role: row.role ?? row.actor_role ?? null,
      detail: row.detail ?? null,
      at: String(row.at || row.occurred_at || ''),
    })),
  };
}

export function buildJobCustodyExport(input: {
  exportedAt?: string;
  job: { id: string; number?: number | null; name?: string | null };
  clips: ClipCustodyExport[];
}): JobCustodyExport {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  return {
    schema: JOB_CUSTODY_SCHEMA,
    exportedAt,
    job: {
      id: input.job.id,
      number: input.job.number ?? null,
      name: input.job.name ?? null,
    },
    clips: input.clips,
  };
}

export function isClipCustodyExport(value: unknown): value is ClipCustodyExport {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  if (rec.schema !== CLIP_CUSTODY_SCHEMA) return false;
  const clip = rec.clip as Record<string, unknown> | undefined;
  const integrity = clip?.integrity as Record<string, unknown> | undefined;
  return Boolean(
    clip &&
      typeof clip.id === 'string' &&
      integrity &&
      integrity.algorithm === 'sha256' &&
      typeof rec.exportedAt === 'string',
  );
}
