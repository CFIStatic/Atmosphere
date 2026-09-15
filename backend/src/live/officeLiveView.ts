/**
 * Office Live / near-live view of Field Capture stream-while-recording.
 *
 * Architecture (MVP — no WebRTC SFU):
 * - FC MediaRecorder timeslice (1s) → DayFilmStreamer groups ~4 MB parts →
 *   PUT to signed `.parts/NNNN` URLs while filming.
 * - createPartUploadUrl upserts proof_live_sessions so the office knows a
 *   clip is live.
 * - Office polls GET …/live and GET …/live/:clipId; we list contiguous landed
 *   parts in storage and mint short-lived signed read URLs.
 * - Browser concatenates WebM/MP4 part bytes into a Blob for <video>.
 *
 * Latency: part fill (~16s at 2 Mbps / 4 MB) + upload + poll (≤5s) ≈ 15–35s.
 * Offline: streamer stops; day-film queue files the full blob later — live
 * session goes stale and drops from the Live list.
 */

import { partObjectPath, PROOF_MAX_PARTS } from '../lib/proofUploadChunks.js';

const PROOF_BUCKET = 'job-proofs';

/** Sessions with no mint for this long are not shown as Live. */
export const LIVE_SESSION_STALE_MS = 15 * 60 * 1000;

/** Documented target lag for office playback of the latest landed part. */
export const LIVE_VIEW_LATENCY_NOTE =
  'Near-live: typically 15–35 seconds behind the camera (part size ~4 MB at ~2 Mbps + upload + poll). Not WebRTC sub-second.';

export type LiveSessionRow = {
  id: string;
  org_id: string;
  job_id: string;
  party_id: string;
  clip_id: string;
  storage_path: string;
  work_date: string;
  phase: string;
  extension: string;
  mime_type: string;
  status: string;
  last_mint_index: number;
  started_at: string;
  last_part_at: string;
  ended_at: string | null;
};

export type OfficeLiveSessionSummary = {
  clipId: string;
  partyId: string;
  workDate: string;
  phase: string;
  mimeType: string;
  extension: string;
  storagePath: string;
  startedAt: string;
  lastPartAt: string;
  lastMintIndex: number;
  status: 'live';
  latencyNote: string;
  privacyNote: string;
};

export const LIVE_PRIVACY_NOTE =
  'Live may show unredacted (raw) footage until the film is filed and analysis applies child blur / private-moment ranges. Prefer the filed player once analysis finishes.';

/** Parse `0000`, `0001.webm`, etc. into part indexes. */
export function parsePartIndexName(name: string): number | null {
  const base = String(name || '').split('/').pop() || '';
  const stem = base.replace(/\.[^.]+$/, '');
  if (!/^\d{1,4}$/.test(stem)) return null;
  const n = Number(stem);
  if (!Number.isInteger(n) || n < 0 || n >= PROOF_MAX_PARTS) return null;
  return n;
}

/** Contiguous prefix starting at 0 — gaps stop the live playable head. */
export function contiguousPartIndexes(have: Iterable<number>): number[] {
  const set = new Set<number>();
  for (const i of have) {
    if (Number.isInteger(i) && i >= 0 && i < PROOF_MAX_PARTS) set.add(i);
  }
  const out: number[] = [];
  for (let i = 0; i < PROOF_MAX_PARTS; i += 1) {
    if (!set.has(i)) break;
    out.push(i);
  }
  return out;
}

export function isLiveSessionFresh(
  lastPartAt: string | Date | null | undefined,
  nowMs = Date.now(),
  staleMs = LIVE_SESSION_STALE_MS,
): boolean {
  if (!lastPartAt) return false;
  const t = typeof lastPartAt === 'string' ? Date.parse(lastPartAt) : lastPartAt.getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= staleMs;
}

export function presentLiveSession(row: LiveSessionRow): OfficeLiveSessionSummary | null {
  if (row.status !== 'live') return null;
  if (!isLiveSessionFresh(row.last_part_at)) return null;
  return {
    clipId: row.clip_id,
    partyId: row.party_id,
    workDate: row.work_date,
    phase: row.phase,
    mimeType: row.mime_type,
    extension: row.extension,
    storagePath: row.storage_path,
    startedAt: row.started_at,
    lastPartAt: row.last_part_at,
    lastMintIndex: row.last_mint_index,
    status: 'live',
    latencyNote: LIVE_VIEW_LATENCY_NOTE,
    privacyNote: LIVE_PRIVACY_NOTE,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function touchProofLiveSession(
  admin: any,
  input: {
    orgId: string;
    jobId: string;
    partyId: string;
    clipId: string;
    storagePath: string;
    workDate: string;
    phase: 'before' | 'after';
    extension: string;
    index: number;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const mimeType = input.extension === 'mp4' ? 'video/mp4' : 'video/webm';
  const row = {
    org_id: input.orgId,
    job_id: input.jobId,
    party_id: input.partyId,
    clip_id: input.clipId,
    storage_path: input.storagePath,
    work_date: input.workDate,
    phase: input.phase,
    extension: input.extension,
    mime_type: mimeType,
    status: 'live',
    last_mint_index: Math.max(0, Math.floor(input.index)),
    last_part_at: now,
    ended_at: null,
    updated_at: now,
  };
  const { data: existing } = await admin
    .from('proof_live_sessions')
    .select('id, started_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('clip_id', input.clipId)
    .maybeSingle();
  if (existing?.id) {
    await admin
      .from('proof_live_sessions')
      .update({
        storage_path: row.storage_path,
        work_date: row.work_date,
        phase: row.phase,
        extension: row.extension,
        mime_type: row.mime_type,
        status: 'live',
        last_mint_index: row.last_mint_index,
        last_part_at: now,
        ended_at: null,
        updated_at: now,
        party_id: row.party_id,
      })
      .eq('id', existing.id);
    return;
  }
  await admin.from('proof_live_sessions').insert({ ...row, started_at: now });
}

export async function endProofLiveSession(
  admin: any,
  input: { orgId: string; jobId: string; clipId: string | null },
): Promise<void> {
  if (!input.clipId) return;
  const now = new Date().toISOString();
  await admin
    .from('proof_live_sessions')
    .update({ status: 'ended', ended_at: now, updated_at: now })
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('clip_id', input.clipId)
    .eq('status', 'live');
}

export async function listLiveSessionsForJob(
  admin: any,
  orgId: string,
  jobId: string,
): Promise<OfficeLiveSessionSummary[]> {
  const { data, error } = await admin
    .from('proof_live_sessions')
    .select(
      'id, org_id, job_id, party_id, clip_id, storage_path, work_date, phase, extension, mime_type, status, last_mint_index, started_at, last_part_at, ended_at',
    )
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('status', 'live')
    .order('last_part_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const out: OfficeLiveSessionSummary[] = [];
  for (const row of (data ?? []) as LiveSessionRow[]) {
    const presented = presentLiveSession(row);
    if (presented) out.push(presented);
  }
  return out;
}

export async function listLandedPartIndexes(
  admin: any,
  storagePath: string,
): Promise<number[]> {
  const folder = `${storagePath}.parts`;
  const { data, error } = await admin.storage.from(PROOF_BUCKET).list(folder, {
    limit: PROOF_MAX_PARTS,
  });
  if (error) return [];
  const indexes: number[] = [];
  for (const entry of (data ?? []) as Array<{ name?: string }>) {
    const n = parsePartIndexName(entry?.name ?? '');
    if (n != null) indexes.push(n);
  }
  return contiguousPartIndexes(indexes);
}

export async function signedLivePartUrls(
  admin: any,
  storagePath: string,
  partIndexes: number[],
  expiresIn = 600,
): Promise<Array<{ index: number; path: string; url: string }>> {
  const out: Array<{ index: number; path: string; url: string }> = [];
  for (const index of partIndexes) {
    const path = partObjectPath(storagePath, index);
    const { data, error } = await admin.storage.from(PROOF_BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) continue;
    out.push({ index, path, url: data.signedUrl });
  }
  return out;
}
