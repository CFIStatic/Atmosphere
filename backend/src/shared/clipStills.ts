/**
 * Stills Chat can look at: the key frames already saved for a clip
 * (job_proof_frames, the same stills the job file report prints). Frames in a
 * private moment or a child range, padded the same way the blurred video copy
 * is, are never returned.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { privacyBlurWindows, secondsInBlurWindow } from '../lib/proofPrivacySafe.js';

const PROOF_BUCKET = 'job-proofs';
/** The model API takes images up to 5 MB; stills are far smaller, this just guards a bad row. */
const MAX_STILL_BYTES = 3_500_000;
export const MAX_STILLS_PER_LOOK = 4;

export type ClipStill = { atSeconds: number; jpeg: Buffer };

export type ClipStillsResult = {
  stills: ClipStill[];
  /** Stills on file for the clip, before privacy and the count limit. */
  onFile: number;
  /** Stills left out because they fall in a private or child range. */
  privateSkipped: number;
};

/** Pick up to `count` frame seconds: nearest to `atSeconds`, or spread over the clip. */
export function pickStillSeconds(seconds: number[], atSeconds: number | null, count: number): number[] {
  const sorted = [...new Set(seconds)].sort((a, b) => a - b);
  const n = Math.max(1, Math.min(count, MAX_STILLS_PER_LOOK));
  if (sorted.length <= n) return sorted;
  if (atSeconds !== null && Number.isFinite(atSeconds)) {
    return [...sorted]
      .sort((a, b) => Math.abs(a - atSeconds) - Math.abs(b - atSeconds) || a - b)
      .slice(0, n)
      .sort((a, b) => a - b);
  }
  const step = (sorted.length - 1) / (n - 1 || 1);
  return Array.from({ length: n }, (_, i) => sorted[Math.round(i * step)]!).filter(
    (v, i, all) => all.indexOf(v) === i,
  );
}

export async function loadClipStills(
  admin: SupabaseClient,
  clip: { proofId: string; privacyRedactions?: unknown; childPrivacyRedactions?: unknown },
  opts: { atSeconds: number | null; count: number },
): Promise<ClipStillsResult> {
  const { data } = await admin
    .from('job_proof_frames')
    .select('at_seconds, storage_path')
    .eq('proof_id', clip.proofId)
    .order('at_seconds');
  const rows = ((data ?? []) as Array<{ at_seconds: unknown; storage_path: unknown }>)
    .map((row) => ({ atSeconds: Number(row.at_seconds) || 0, path: row.storage_path ? String(row.storage_path) : '' }))
    .filter((row) => row.path);
  const windows = privacyBlurWindows({
    privacyRedactions: clip.privacyRedactions,
    childPrivacyRedactions: clip.childPrivacyRedactions,
  });
  const visible = rows.filter((row) => !secondsInBlurWindow(row.atSeconds, windows));
  const chosen = new Set(pickStillSeconds(visible.map((row) => row.atSeconds), opts.atSeconds, opts.count));
  const stills: ClipStill[] = [];
  for (const row of visible) {
    if (!chosen.has(row.atSeconds)) continue;
    chosen.delete(row.atSeconds);
    try {
      const { data: blob, error } = await admin.storage.from(PROOF_BUCKET).download(row.path);
      if (error || !blob) continue;
      const jpeg = Buffer.from(await blob.arrayBuffer());
      if (jpeg.length && jpeg.length <= MAX_STILL_BYTES) stills.push({ atSeconds: row.atSeconds, jpeg });
    } catch {
      // A broken still is skipped; the others still come back.
    }
  }
  return { stills, onFile: rows.length, privateSkipped: rows.length - visible.length };
}
