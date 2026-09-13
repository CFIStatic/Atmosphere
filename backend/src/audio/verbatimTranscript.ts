/**
 * Verbatim Whisper transcript for exact conversation recall.
 *
 * The filed `transcript_text` is ground truth. This module only segments it
 * for seek + search — it never paraphrases or LLM-rewrites speech.
 */

export type VerbatimSegment = {
  /** Seek time from a [m:ss] / [h:mm:ss] stamp when present. */
  tSec: number | null;
  /** Exact transcript text for this stamp (or the whole unstamped blob). */
  text: string;
  /** Best-effort speaker label when the line leads with Homeowner:/Crew: etc. */
  speakerLabel?: string | null;
};

const SPEAKER_LEAD =
  /^(homeowner|owner|home owner|contractor|crew|tech|technician|worker|adjuster|inspector|speaker\s*[a-d]|person\s*[12])\s*[:\-–—]\s*/i;

function clockToSeconds(raw: string): number | null {
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 1) return parts[0]!;
  return null;
}

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function normalizeSpeaker(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/^home\s*owner|^owner$/.test(s)) return 'Homeowner';
  if (/^contractor|^crew|^tech|^technician|^worker/.test(s)) return 'Crew';
  if (/^adjuster/.test(s)) return 'Adjuster';
  if (/^inspector/.test(s)) return 'Inspector';
  if (/^speaker\s*a|^person\s*1/.test(s)) return 'Speaker A';
  if (/^speaker\s*b|^person\s*2/.test(s)) return 'Speaker B';
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24) || null;
}

/**
 * Full timestamped transcript segments — no truncation, no paraphrase.
 * Safety: empty input → []. Pathological dumps still return every stamp.
 */
export function parseVerbatimTranscript(transcript: string | null | undefined): VerbatimSegment[] {
  const src = String(transcript || '').trim();
  if (!src) return [];

  const re = /\[((?:\d+:)+\d+)\]/g;
  const stamps: Array<{ at: number; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const at = clockToSeconds(match[1] ?? '');
    if (at == null || !Number.isFinite(at) || at < 0) continue;
    stamps.push({ at, index: match.index, end: match.index + match[0].length });
  }

  const chunks: Array<{ at: number | null; text: string }> = [];
  if (!stamps.length) {
    chunks.push({ at: null, text: src });
  } else {
    for (let i = 0; i < stamps.length; i += 1) {
      const stamp = stamps[i]!;
      const next = stamps[i + 1];
      const body = src
        .slice(stamp.end, next ? next.index : src.length)
        .replace(/^[\s:,.\-–—]+/, '')
        .trim();
      if (!body) continue;
      chunks.push({ at: stamp.at, text: body });
    }
  }

  const out: VerbatimSegment[] = [];
  for (const chunk of chunks) {
    const pieces = chunk.text
      .split(
        /(?=(?:\bHomeowner\b|\bOwner\b|\bHome owner\b|\bContractor\b|\bCrew\b|\bTech(?:nician)?\b|\bWorker\b|\bAdjuster\b|\bInspector\b|\bSpeaker\s*[A-D]\b|\bPerson\s*[12]\b)\s*[:\-–—])/i,
      )
      .map((p) => p.trim())
      .filter(Boolean);
    const parts = pieces.length ? pieces : [chunk.text];
    for (const part of parts) {
      const lead = part.match(SPEAKER_LEAD);
      if (lead) {
        out.push({
          tSec: chunk.at == null ? null : roundTime(chunk.at),
          text: part.slice(lead[0].length).trim() || part,
          speakerLabel: normalizeSpeaker(lead[1] ?? ''),
        });
      } else {
        out.push({
          tSec: chunk.at == null ? null : roundTime(chunk.at),
          text: part,
          speakerLabel: null,
        });
      }
    }
  }
  return out.filter((row) => row.text.length > 0);
}

/** Locate an exact (or near-exact) quote inside the transcript for grounding. */
export function findVerbatimQuote(
  transcript: string | null | undefined,
  needle: string | null | undefined,
): { quote: string; tSec: number | null } | null {
  const hay = String(transcript || '');
  const want = String(needle || '').trim();
  if (!hay || !want) return null;
  const segments = parseVerbatimTranscript(hay);
  const lowerWant = want.toLowerCase();
  for (const seg of segments) {
    if (seg.text.toLowerCase().includes(lowerWant) || lowerWant.includes(seg.text.toLowerCase().slice(0, 48))) {
      // Prefer the needle as it appears in the segment when possible.
      const idx = seg.text.toLowerCase().indexOf(lowerWant.slice(0, Math.min(lowerWant.length, 80)));
      const quote =
        idx >= 0
          ? seg.text.slice(idx, idx + Math.min(want.length, seg.text.length - idx)).trim() || seg.text
          : seg.text;
      return { quote: quote.slice(0, 500), tSec: seg.tSec };
    }
  }
  const plainIdx = hay.toLowerCase().indexOf(lowerWant.slice(0, Math.min(lowerWant.length, 80)));
  if (plainIdx >= 0) {
    return { quote: hay.slice(plainIdx, plainIdx + want.length).trim().slice(0, 500), tSec: null };
  }
  return null;
}
