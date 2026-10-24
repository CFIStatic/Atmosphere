/**
 * find_frames: the video stills that show a subject ("the stairs") on a day or
 * range of days, so Chat can put the pictures in its answer and compare two
 * days side by side.
 *
 * Only clips already in the person's Chat scope are searched (the catalog is
 * filtered for homeowners, subs and hidden clips before it gets here), and no
 * still from a private moment or a child range is ever returned.
 *
 * Signals per timed window of a clip, best first:
 * - room segments (clip_room_segments: "Stairwell 0:40–1:25")
 * - analysis chunks (ask_analysis_chunks: findings / actions with times, with
 *   their stored embeddings when the query can be embedded)
 * - long-recording readings (job_proof_segments.reading)
 * - transcript lines (what was said near the frame)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { privacyBlurWindows, secondsInBlurWindow } from '../lib/proofPrivacySafe.js';
import { cosineSimilarity, embedText, askEmbeddingsEnabled } from './askEmbeddings.js';
import { askClipCite, clipsInScope, type AskLookupCatalog, type AskLookupClip } from './askLookup.js';

type DbRow = Record<string, unknown>;

export const MAX_FRAMES_PER_FIND = 8;

/** Seconds before / after a matched moment that its Chat clip plays. */
export const CLIP_BEFORE_SECONDS = 5;
export const CLIP_AFTER_SECONDS = 10;

/**
 * The short clip around a matched moment: 5 s before to 10 s after, kept
 * inside the video. Chat plays just this window, never the whole video.
 */
export function clipWindow(atSeconds: number, durationSeconds?: number | null): { start: number; end: number } {
  const at = Math.max(0, Number(atSeconds) || 0);
  const dur = Number(durationSeconds);
  const max = Number.isFinite(dur) && dur > 0 ? dur : Infinity;
  let start = Math.max(0, at - CLIP_BEFORE_SECONDS);
  let end = Math.min(max, at + CLIP_AFTER_SECONDS);
  // Near the end of a video, slide back so the clip is still ~15 s long.
  if (end - start < CLIP_BEFORE_SECONDS + CLIP_AFTER_SECONDS && Number.isFinite(max)) start = Math.max(0, end - CLIP_BEFORE_SECONDS - CLIP_AFTER_SECONDS);
  if (!(end > start)) end = start + 1;
  return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
}

export type FrameWindow = {
  proofId: string;
  start: number;
  end: number;
  text: string;
  /** room > analysis > reading > speech */
  kind: 'room' | 'analysis' | 'reading' | 'speech';
  embedding?: number[] | null;
};

export type FrameRow = { proofId: string; atSeconds: number; storagePath: string };

export type FoundFrame = {
  proofId: string;
  jobId: string;
  title: string;
  workDate: string | null;
  atSeconds: number;
  cite: string;
  /** The short clip Chat plays around this moment. */
  clipStart: number;
  clipEnd: number;
  why: string;
  score: number;
  storagePath: string;
};

export type FrameSearchArgs = {
  subject: string;
  dates?: string[];
  from?: string | null;
  to?: string | null;
  limit?: number;
};

const SYNONYMS: Record<string, string[]> = {
  stair: ['stairs', 'staircase', 'stairway', 'stairwell', 'steps', 'step', 'tread', 'treads', 'riser', 'risers', 'landing'],
  ceiling: ['ceilings', 'drywall overhead'],
  roof: ['roofing', 'shingles', 'shingle', 'decking', 'attic'],
  kitchen: ['cabinets', 'countertop', 'countertops'],
  bathroom: ['bath', 'shower', 'tub', 'vanity', 'toilet'],
  floor: ['flooring', 'subfloor', 'hardwood', 'tile', 'carpet', 'laminate'],
  wall: ['walls', 'drywall', 'sheetrock'],
  window: ['windows', 'glass'],
  basement: ['crawlspace', 'foundation'],
  mold: ['mould', 'microbial'],
  water: ['moisture', 'wet', 'leak', 'flood'],
};

const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'at', 'show', 'me', 'my', 'and', 'or', 'to', 'what', 'how', 'it', 'is', 'was', 'with', 'from', 'this', 'that', 'did', 'look', 'like', 'pictures', 'picture', 'photos', 'photo', 'frames', 'frame']);

function stem(word: string): string {
  return word.replace(/(ies)$/, 'y').replace(/(es|s)$/, '').replace(/ing$/, '');
}

/** The words to look for: the subject's words, their stems and trade synonyms. */
export function subjectTerms(subject: string): string[] {
  const words = subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const out = new Set<string>();
  for (const word of words) {
    out.add(stem(word));
    for (const [key, list] of Object.entries(SYNONYMS)) {
      const group = [key, ...list].map(stem);
      if (group.includes(stem(word))) group.forEach((g) => out.add(g));
    }
  }
  return [...out].filter(Boolean);
}

function lexicalScore(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  const bag = new Set(words);
  const hits = terms.filter((t) => bag.has(t) || (t.includes(' ') && text.toLowerCase().includes(t))).length;
  return hits ? Math.min(1, 0.6 + 0.2 * hits) : 0;
}

const KIND_WEIGHT: Record<FrameWindow['kind'], number> = { room: 1, analysis: 0.9, reading: 0.85, speech: 0.6 };

/** YYYY-MM-DD for a clip: its work date, else the local day it was filmed. */
export function clipDay(clip: AskLookupClip, timeZone: string): string | null {
  if (clip.workDate && /^\d{4}-\d{2}-\d{2}/.test(clip.workDate)) return clip.workDate.slice(0, 10);
  if (!clip.capturedAt) return null;
  const d = new Date(clip.capturedAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function dayOk(day: string | null, args: FrameSearchArgs): boolean {
  const dates = (args.dates ?? []).map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const from = args.from && /^\d{4}-\d{2}-\d{2}/.test(args.from) ? args.from.slice(0, 10) : null;
  const to = args.to && /^\d{4}-\d{2}-\d{2}/.test(args.to) ? args.to.slice(0, 10) : null;
  if (!dates.length && !from && !to) return true;
  if (!day) return false;
  if (dates.length) return dates.includes(day);
  return (!from || day >= from) && (!to || day <= to);
}

/**
 * Rank the frames. Pure: the loader feeds it rows, tests feed it fixtures.
 * When several dates are asked for, each date gets its share of the limit so
 * a before/after always has both sides.
 */
export function rankFrames(input: {
  catalog: AskLookupCatalog;
  args: FrameSearchArgs;
  windows: FrameWindow[];
  frames: FrameRow[];
  queryEmbedding?: number[] | null;
}): FoundFrame[] {
  const { catalog, args } = input;
  const zone = catalog.timeZone || 'America/Chicago';
  const limit = Math.max(1, Math.min(MAX_FRAMES_PER_FIND, Math.round(args.limit ?? 6)));
  const terms = subjectTerms(args.subject);
  const clips = new Map(
    clipsInScope(catalog)
      .filter((clip) => dayOk(clipDay(clip, zone), args))
      .map((clip) => [clip.proofId, clip]),
  );
  const framesByProof = new Map<string, FrameRow[]>();
  for (const row of input.frames) {
    if (!clips.has(row.proofId) || !row.storagePath) continue;
    framesByProof.set(row.proofId, [...(framesByProof.get(row.proofId) ?? []), row]);
  }
  const candidates: FoundFrame[] = [];
  for (const w of input.windows) {
    const clip = clips.get(w.proofId);
    if (!clip) continue;
    const lex = lexicalScore(w.text, terms);
    const sem =
      input.queryEmbedding && w.embedding?.length ? Math.max(0, (cosineSimilarity(input.queryEmbedding, w.embedding) - 0.25) / 0.35) : 0;
    const score = Math.min(1, Math.max(lex, sem)) * KIND_WEIGHT[w.kind];
    if (score < 0.3) continue;
    const blur = privacyBlurWindows({ privacyRedactions: clip.privacyRedactions, childPrivacyRedactions: clip.childPrivacyRedactions });
    const mid = (w.start + w.end) / 2;
    const pool = (framesByProof.get(w.proofId) ?? []).filter(
      (f) => f.atSeconds >= w.start - 2 && f.atSeconds <= w.end + 2 && !secondsInBlurWindow(f.atSeconds, blur),
    );
    const best = pool.sort((a, b) => Math.abs(a.atSeconds - mid) - Math.abs(b.atSeconds - mid))[0];
    if (!best) continue;
    candidates.push({
      proofId: clip.proofId,
      jobId: clip.jobId,
      title: clip.title,
      workDate: clipDay(clip, zone),
      atSeconds: Math.round(best.atSeconds * 10) / 10,
      cite: askClipCite(clip, best.atSeconds),
      ...(() => {
        const w = clipWindow(best.atSeconds, clip.durationSeconds);
        return { clipStart: w.start, clipEnd: w.end };
      })(),
      why: w.text.replace(/\s+/g, ' ').trim().slice(0, 160),
      score,
      storagePath: best.storagePath,
    });
  }
  // Best first; one still per clip moment (8 s apart), two per clip at most.
  candidates.sort((a, b) => b.score - a.score || a.atSeconds - b.atSeconds);
  const picked: FoundFrame[] = [];
  const perClip = new Map<string, number>();
  const days = [...new Set(candidates.map((c) => c.workDate ?? ''))];
  const perDay = days.length > 1 ? Math.max(1, Math.floor(limit / days.length)) : limit;
  const dayCount = new Map<string, number>();
  const take = (c: FoundFrame, capDay: boolean) => {
    if (picked.length >= limit) return;
    if (picked.some((p) => p.proofId === c.proofId && Math.abs(p.atSeconds - c.atSeconds) < 8)) return;
    if ((perClip.get(c.proofId) ?? 0) >= 2) return;
    const day = c.workDate ?? '';
    if (capDay && (dayCount.get(day) ?? 0) >= perDay) return;
    picked.push(c);
    perClip.set(c.proofId, (perClip.get(c.proofId) ?? 0) + 1);
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);
  };
  for (const c of candidates) take(c, true);
  for (const c of candidates) take(c, false);
  return picked.sort((a, b) => String(a.workDate).localeCompare(String(b.workDate)) || a.atSeconds - b.atSeconds);
}

function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try {
      return (JSON.parse(raw) as unknown[]).map(Number);
    } catch {
      return null;
    }
  }
  return null;
}

function readingText(reading: unknown): string {
  if (!reading) return '';
  if (typeof reading === 'string') return reading;
  try {
    return JSON.stringify(reading).replace(/["{}[\]]/g, ' ').replace(/\\n/g, ' ');
  } catch {
    return '';
  }
}

/** Load the windows and stills for the clips in scope, then rank. */
export async function findFrames(
  admin: SupabaseClient,
  catalog: AskLookupCatalog,
  args: FrameSearchArgs,
  opts?: { embed?: (text: string) => Promise<number[] | null> },
): Promise<FoundFrame[]> {
  const zone = catalog.timeZone || 'America/Chicago';
  const clips = clipsInScope(catalog).filter((clip) => dayOk(clipDay(clip, zone), args));
  const ids = clips.map((c) => c.proofId).slice(0, 200);
  if (!ids.length || !String(args.subject ?? '').trim()) return [];
  const embedQuery = opts?.embed ?? (askEmbeddingsEnabled() ? (t: string) => embedText(t, { timeoutMs: 6000 }) : null);
  const [frames, rooms, chunks, readings, queryEmbedding] = await Promise.all([
    admin.from('job_proof_frames').select('proof_id, at_seconds, storage_path').in('proof_id', ids).order('at_seconds'),
    admin.from('clip_room_segments').select('proof_id, room_name, start_seconds, end_seconds, findings').in('proof_id', ids),
    admin
      .from('ask_analysis_chunks')
      .select('proof_id, kind, start_sec, end_sec, text, embedding')
      .in('proof_id', ids)
      .not('start_sec', 'is', null),
    admin.from('job_proof_segments').select('proof_id, start_seconds, end_seconds, reading').in('proof_id', ids),
    embedQuery ? embedQuery(args.subject).catch(() => null) : Promise.resolve(null),
  ]);
  const windows: FrameWindow[] = [];
  for (const r of (rooms.data ?? []) as DbRow[]) {
    windows.push({
      proofId: String(r.proof_id),
      start: Number(r.start_seconds) || 0,
      end: Number(r.end_seconds) || 0,
      text: `${r.room_name ?? ''} ${readingText(r.findings)}`,
      kind: 'room',
    });
  }
  for (const c of (chunks.data ?? []) as DbRow[]) {
    const start = Number(c.start_sec) || 0;
    windows.push({
      proofId: String(c.proof_id),
      start,
      end: c.end_sec == null ? start + 4 : Number(c.end_sec),
      text: String(c.text ?? ''),
      kind: 'analysis',
      embedding: parseVector(c.embedding),
    });
  }
  for (const s of (readings.data ?? []) as DbRow[]) {
    windows.push({
      proofId: String(s.proof_id),
      start: Number(s.start_seconds) || 0,
      end: Number(s.end_seconds) || 0,
      text: readingText(s.reading),
      kind: 'reading',
    });
  }
  for (const clip of clips) {
    for (const seg of clip.segments ?? []) {
      if (!seg?.text) continue;
      windows.push({ proofId: clip.proofId, start: Number(seg.start) || 0, end: Number(seg.end) || 0, text: seg.text, kind: 'speech' });
    }
  }
  const frameRows: FrameRow[] = ((frames.data ?? []) as DbRow[]).map((f) => ({
    proofId: String(f.proof_id),
    atSeconds: Number(f.at_seconds) || 0,
    storagePath: f.storage_path ? String(f.storage_path) : '',
  }));
  return rankFrames({ catalog, args, windows, frames: frameRows, queryEmbedding });
}

export type FindFramesFn = (args: FrameSearchArgs) => Promise<{ frames: FoundFrame[]; jpegs: Array<Buffer | null> }>;

/** Server loader: rank, then fetch the first few stills so the model can check them. */
export function framesFinderFor(admin: SupabaseClient, catalog: AskLookupCatalog, previewCount = 4): FindFramesFn {
  return async (args) => {
    const frames = await findFrames(admin, catalog, args);
    const jpegs = await Promise.all(
      frames.map(async (frame, i) => {
        if (i >= previewCount) return null;
        try {
          const { data, error } = await admin.storage.from('job-proofs').download(frame.storagePath);
          if (error || !data) return null;
          const buf = Buffer.from(await data.arrayBuffer());
          return buf.length && buf.length <= 3_500_000 ? buf : null;
        } catch {
          return null;
        }
      }),
    );
    return { frames, jpegs };
  };
}

const FRAMES_TRAILER_RE = /\s*⟦frames:\s*([^⟧]*)⟧\s*/gi;

/**
 * Keep only frame ids that a frame tool returned this turn; when the model
 * forgot the line but found frames, show what it found.
 */
export function finalizeFramesTrailer(answer: string, allowedIds: string[], fallback: string[]): string {
  const allowed = new Set(allowedIds);
  let wrote: string[] = [];
  const body = answer.replace(FRAMES_TRAILER_RE, (_full, ids: string) => {
    wrote = wrote.concat(ids.split(',').map((id) => id.trim()).filter((id) => allowed.has(id)));
    return '\n';
  }).trimEnd();
  const keep = [...new Set(wrote.length ? wrote : fallback)].slice(0, MAX_FRAMES_PER_FIND);
  if (!keep.length) return body;
  // Before the sources / follow-up lines so the pictures sit under the prose.
  const at = body.search(/\n*⟦(?:sources|followups|quotes|actions):/i);
  const line = `⟦frames: ${keep.join(', ')}⟧`;
  return at === -1 ? `${body}\n\n${line}` : `${body.slice(0, at).trimEnd()}\n\n${line}\n\n${body.slice(at).trimStart()}`;
}
