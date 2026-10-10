/**
 * The job file's Videos tab and the Dashboard describe the same clips, so
 * they must name them the same way. The Dashboard (verifier clipListLabel)
 * paints: office custom title → AI title → "Video · <short id>", beside the
 * clip's poster still. These helpers are that rule for the React job file,
 * fed from the same /api/evidence-portal/library rows.
 */
import type { ProofVideoRecord } from './api';
import { clipProcessing } from './clipProcessing';

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
const CLIP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CLIP_ROOMS = [
  'living room', 'family room', 'dining room', 'kitchen', 'primary bathroom', 'bathroom', 'bedroom', 'basement',
  'attic', 'roof', 'garage', 'laundry room', 'laundry', 'hallway', 'closet', 'office', 'crawlspace', 'exterior',
];

/** Same rule as the backend (#704): a cut-off AI description is not a title. */
export function looksLikeDescriptionTitle(title: string): boolean {
  const t = String(title ?? '').trim();
  if (!t) return false;
  const words = t.split(/\s+/);
  if (/[,;:]/.test(t) && words.length >= 4) return true;
  if (/\b(likely|appears?|probably|possibly|seems?|filmed|handheld|footage|recording of|shows?|showing|captured|captures)\b/i.test(t)) return true;
  if (/\b(a|an|the|and|of|with|in|on|to|from|inside|featuring)$/i.test(t)) return true;
  if (/…$|\.\.\.$/.test(t)) return true;
  return words.length > 9;
}

/** "Kitchen walk-through · Oct 8" — the room from the title or the clip's rooms, the local work day. */
export function shortClipName(title: string, workDate?: string | null, roomHint?: string | null): string {
  const lower = `${title} ${roomHint ?? ''}`.toLowerCase().replace(/[_-]+/g, ' ');
  const room = CLIP_ROOMS.find((r) => lower.includes(r));
  const m = String(workDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const day = m ? `${CLIP_MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}` : '';
  const head = room ? `${room[0]!.toUpperCase()}${room.slice(1)} walk-through` : 'Walk-through';
  return day ? `${head} · ${day}` : head;
}

export function clipDisplayTitle(
  video: Pick<ProofVideoRecord, 'id'> & { workDate?: string | null; rooms?: Array<{ roomName: string }> | null },
  meta?: LibraryClipMeta | null,
): string {
  const custom = String(meta?.customTitle ?? '').trim();
  if (custom) return custom;
  const stored = String(meta?.aiTitle ?? meta?.title ?? '').trim();
  if (stored && looksLikeDescriptionTitle(stored)) {
    const roomHint = (video.rooms ?? []).map((r) => r.roomName).find((n) => n && n !== 'room unclear') ?? null;
    return shortClipName(stored, video.workDate, roomHint);
  }
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

/** One status word per clip, from the shared clip-processing model. */
export function videoRowStatus(
  video: Pick<
    ProofVideoRecord,
    | 'analysisStatus'
    | 'transcriptStatus'
    | 'narrationStatus'
    | 'conversation'
    | 'proofState'
    | 'summaryState'
    | 'hasSummary'
    | 'noSpeech'
    | 'uploading'
    | 'retrying'
    | 'transcriptActive'
    | 'analysisActive'
    | 'narrationActive'
    | 'summaryActive'
  >,
): { label: string; tone: VideoRowTone } {
  const derived = clipProcessing({
    proofState: video.proofState,
    analysisStatus: video.analysisStatus,
    transcriptStatus: video.transcriptStatus,
    narrationStatus: video.narrationStatus,
    summaryState: video.conversation?.summaryState ?? video.summaryState,
    hasSummary: video.hasSummary,
    noSpeech: video.noSpeech,
    uploading: video.uploading,
    retrying: video.retrying,
    transcriptActive: video.transcriptActive,
    analysisActive: video.analysisActive,
    narrationActive: video.narrationActive,
    summaryActive: video.summaryActive,
  });
  return { label: derived.label, tone: derived.tone };
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
