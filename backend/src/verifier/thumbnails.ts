/**
 * Library preview stills — a real frame from the clip, not an illustration.
 *
 * The Dashboard list used to draw a synthetic room because the portal never
 * asked storage for a JPEG. Frames already live in `job_proof_frames` (device
 * stills on upload, sparse FFmpeg stills after analysis). This module picks
 * one, signs it, and — when a clip arrived with none — extracts a single
 * preview from the stored video so the list does not sit empty until the
 * narration worker runs.
 */

import { createAdminClient } from '../lib/supabase.js';
import { config } from '../config.js';
import {
  extractPreviewFrameFromUrl,
  pickPreviewFrame,
  previewAtSeconds,
} from '../shared/sparseExtract.js';

const PROOF_BUCKET = 'job-proofs';
const THUMB_TTL_SECONDS = 3600;
const ID_CHUNK = 80;
const PATH_CHUNK = 100;
const MAX_CONCURRENT_EXTRACTS = 2;

export { pickPreviewFrame, previewAtSeconds };

export type ProofPreviewRow = {
  id: string;
  org_id: string;
  job_id: string;
  party_id: string | null;
  work_date: string;
  phase: string;
  storage_path: string | null;
  duration_seconds: number | null;
};

type FrameRow = { proof_id: string; atSeconds: number; storage_path: string };

const extractInflight = new Map<string, Promise<{ storagePath: string; atSeconds: number } | null>>();
let extractActive = 0;
const extractWait: Array<() => void> = [];

function acquireExtractSlot(): Promise<void> {
  if (extractActive < MAX_CONCURRENT_EXTRACTS) {
    extractActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    extractWait.push(() => {
      extractActive += 1;
      resolve();
    });
  });
}

function releaseExtractSlot(): void {
  extractActive = Math.max(0, extractActive - 1);
  const next = extractWait.shift();
  if (next) next();
}

async function signPaths(
  admin: any,
  paths: string[],
  ttlSeconds = THUMB_TTL_SECONDS,
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (!paths.length) return signed;
  for (let i = 0; i < paths.length; i += PATH_CHUNK) {
    const chunk = paths.slice(i, i + PATH_CHUNK);
    const { data } = await admin.storage.from(PROOF_BUCKET).createSignedUrls(chunk, ttlSeconds);
    for (const row of (data ?? []) as Array<{ path?: string | null; signedUrl?: string | null }>) {
      if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl);
    }
  }
  return signed;
}

async function framesForProofs(admin: any, proofIds: string[]): Promise<FrameRow[]> {
  const out: FrameRow[] = [];
  for (let i = 0; i < proofIds.length; i += ID_CHUNK) {
    const chunk = proofIds.slice(i, i + ID_CHUNK);
    const { data, error } = await admin
      .from('job_proof_frames')
      .select('proof_id, at_seconds, storage_path')
      .in('proof_id', chunk)
      .order('at_seconds');
    if (error) {
      console.warn('[thumbnails] frame lookup failed:', error.message);
      continue;
    }
    for (const row of (data ?? []) as any[]) {
      if (!row?.proof_id || !row?.storage_path) continue;
      out.push({
        proof_id: String(row.proof_id),
        atSeconds: Number(row.at_seconds),
        storage_path: String(row.storage_path),
      });
    }
  }
  return out;
}

/**
 * Attach `thumbnailUrl` on each library item from an existing still.
 * Missing stills stay unset — the list falls back to a placeholder rather
 * than blocking the library on FFmpeg.
 */
export async function attachThumbnailUrls(
  items: Array<{ id: string; durationSeconds?: number | null; thumbnailUrl?: string | null }>,
  opts?: { client?: any; ttlSeconds?: number },
): Promise<void> {
  if (!items.length) return;
  const admin = opts?.client ?? createAdminClient();
  if (!admin) return;

  const frames = await framesForProofs(
    admin,
    items.map((item) => item.id),
  );
  if (!frames.length) return;

  const byProof = new Map<string, FrameRow[]>();
  for (const frame of frames) {
    const list = byProof.get(frame.proof_id) ?? [];
    list.push(frame);
    byProof.set(frame.proof_id, list);
  }

  const durationById = new Map(items.map((item) => [item.id, item.durationSeconds ?? null]));
  const chosen = new Map<string, string>();
  for (const [proofId, list] of byProof) {
    const frame = pickPreviewFrame(list, durationById.get(proofId));
    if (frame?.storage_path) chosen.set(proofId, frame.storage_path);
  }
  if (!chosen.size) return;

  const signed = await signPaths(admin, [...new Set(chosen.values())], opts?.ttlSeconds);
  for (const item of items) {
    const path = chosen.get(item.id);
    const url = path ? signed.get(path) : null;
    if (url) item.thumbnailUrl = url;
  }
}

async function existingPreview(
  admin: any,
  proof: ProofPreviewRow,
): Promise<{ storagePath: string; atSeconds: number } | null> {
  const frames = await framesForProofs(admin, [proof.id]);
  const picked = pickPreviewFrame(frames, proof.duration_seconds);
  return picked ? { storagePath: picked.storage_path, atSeconds: picked.atSeconds } : null;
}

async function extractAndStorePreview(
  admin: any,
  proof: ProofPreviewRow,
): Promise<{ storagePath: string; atSeconds: number } | null> {
  if (!proof.storage_path) return null;
  const { data: signed, error: signErr } = await admin.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(proof.storage_path, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    console.warn('[thumbnails] could not sign video for preview:', signErr?.message);
    return null;
  }

  await acquireExtractSlot();
  try {
    const extracted = await extractPreviewFrameFromUrl({
      url: signed.signedUrl,
      durationSeconds: proof.duration_seconds,
      ffmpegPath: config.verification.ffmpegPath,
    });
    const at = Math.round(extracted.atSeconds * 100) / 100;
    const storagePath = `${proof.org_id}/${proof.job_id}/${proof.party_id ?? 'party'}/${proof.work_date}-${proof.phase}-preview.jpg`;
    const { error: uploadErr } = await admin.storage.from(PROOF_BUCKET).upload(storagePath, extracted.jpeg, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (uploadErr) {
      console.warn('[thumbnails] preview upload failed:', uploadErr.message);
      return null;
    }
    await admin.from('job_proof_frames').upsert(
      {
        org_id: proof.org_id,
        proof_id: proof.id,
        at_seconds: at,
        storage_path: storagePath,
      },
      { onConflict: 'proof_id,at_seconds' },
    );
    return { storagePath, atSeconds: at };
  } catch (err) {
    console.warn('[thumbnails] preview extract failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    releaseExtractSlot();
  }
}

/**
 * Return a stored preview still, extracting one from the video when the
 * clip arrived without device frames. Dedupes in-flight work per proof.
 */
export async function ensurePreviewFrame(
  admin: any,
  proof: ProofPreviewRow,
): Promise<{ storagePath: string; atSeconds: number } | null> {
  const existing = await existingPreview(admin, proof);
  if (existing) return existing;

  const pending = extractInflight.get(proof.id);
  if (pending) return pending;

  const work = extractAndStorePreview(admin, proof).finally(() => {
    extractInflight.delete(proof.id);
  });
  extractInflight.set(proof.id, work);
  return work;
}

/** Fire-and-forget extract so a just-uploaded clip has a list still. */
export function queuePreviewFrame(admin: any, proof: ProofPreviewRow): void {
  void ensurePreviewFrame(admin, proof).catch((err) => {
    console.warn('[thumbnails] queued preview failed:', err instanceof Error ? err.message : err);
  });
}

export async function signedPreviewUrl(
  admin: any,
  proof: ProofPreviewRow,
  ttlSeconds = THUMB_TTL_SECONDS,
): Promise<string | null> {
  const stored = await ensurePreviewFrame(admin, proof);
  if (!stored) return null;
  const { data, error } = await admin.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(stored.storagePath, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl as string;
}
