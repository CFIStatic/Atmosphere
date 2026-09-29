/**
 * The job file's Videos tab and the Dashboard describe the same clips, so
 * they must name them the same way. The Dashboard (verifier clipListLabel)
 * paints: office custom title → AI title → "Video · <short id>", beside the
 * clip's poster still. These helpers are that rule for the React job file,
 * fed from the same /api/evidence-portal/library rows.
 */
import type { ProofVideoRecord } from './api';

export interface LibraryClipMeta {
  id: string;
  jobId?: string | null;
  title?: string | null;
  customTitle?: string | null;
  aiTitle?: string | null;
  clipId?: string | null;
  posterUrl?: string | null;
}

/** Last 8 of the recording id, like the Dashboard's shortClipListId. */
export function shortClipId(id: string, clipId?: string | null): string {
  const clip = String(clipId ?? '').trim().toLowerCase();
  if (/^[a-z0-9]{6,32}$/.test(clip)) return clip.slice(0, 8);
  const compact = String(id ?? '').trim().replace(/-/g, '');
  return compact.length >= 6 ? compact.slice(-8) : '';
}

/** The clip's name exactly as the Dashboard's Videos list prints it. */
export function clipDisplayTitle(video: Pick<ProofVideoRecord, 'id'>, meta?: LibraryClipMeta | null): string {
  const custom = String(meta?.customTitle ?? '').trim();
  if (custom) return custom;
  const stored = String(meta?.aiTitle ?? meta?.title ?? '').trim();
  if (stored) return stored;
  const short = shortClipId(video.id, meta?.clipId);
  return short ? `Video · ${short}` : 'Video';
}

/** Player-style length: 0:44, 12:03, 1:02:09 (the Dashboard's thumbnail badge). */
export function clipClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type VideoRowTone = 'good' | 'progress' | 'bad' | 'neutral';

/** One status word per clip: is it still being processed, done, or stuck. */
export function videoRowStatus(
  video: Pick<ProofVideoRecord, 'analysisStatus' | 'transcriptStatus' | 'narrationStatus'>,
): { label: string; tone: VideoRowTone } {
  const busy = (s: string | null | undefined) => s === 'queued' || s === 'running' || s === 'pending';
  const analysis = video.analysisStatus ?? null;
  if (analysis === 'failed') return { label: 'Needs attention', tone: 'bad' };
  if (busy(analysis) || busy(video.transcriptStatus) || busy(video.narrationStatus)) {
    return { label: 'Processing', tone: 'progress' };
  }
  if (analysis === 'done') return { label: 'Analyzed', tone: 'good' };
  return { label: 'Recorded', tone: 'neutral' };
}

export interface ClipMoment {
  atSeconds: number;
  text: string;
}

/**
 * Up to `limit` seekable moments for the row: Analysis event boundaries
 * first; a clip without them offers its timestamped transcript lines.
 */
export function clipMoments(
  video: Pick<ProofVideoRecord, 'events' | 'transcriptSegments'>,
  limit = 4,
): ClipMoment[] {
  const out: ClipMoment[] = [];
  const seen = new Set<number>();
  const add = (at: number | null | undefined, text: string | null | undefined) => {
    if (at == null || !Number.isFinite(at) || at < 0) return;
    const words = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!words) return;
    const key = Math.round(at);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ atSeconds: at, text: words });
  };
  for (const event of video.events ?? []) add(event.atSeconds, event.text);
  if (!out.length) {
    for (const segment of video.transcriptSegments ?? []) add(segment.tSec, segment.text);
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds).slice(0, limit);
}

/** A moment's clock — 0:00 is a real moment, unlike a 0-second clip length. */
export function momentClock(seconds: number): string {
  return seconds > 0 ? clipClock(seconds) : '0:00';
}
