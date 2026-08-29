/**
 * Turn a Whisper blob into the lines Scope already parses.
 *
 * The side log only prints speech that looks like `[0:12] …`. A raw
 * paragraph from the transcriber would sit in the record and never
 * appear next to the playhead. This is the one formatter both persist
 * and serialize use, so old unstamped rows still become readable.
 */

export type TranscriptSegment = {
  start: number;
  end?: number;
  text: string;
};

const STAMPED_LINE = /^\[((?:\d+:)+\d+)\]\s*(.+)$/;
const SPEAKER =
  /(?=\b(?:Homeowner|Contractor|Owner|Adjuster|Worker|Technician|Inspector|Customer)\s*:)/i;

export function stampClock(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function parseTranscriptClock(stamp: string): number | null {
  const parts = String(stamp || '')
    .split(':')
    .map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return null;
}

export function splitTranscriptUtterances(text: string): string[] {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const speakerParts = raw.split(SPEAKER).map((p) => p.trim()).filter(Boolean);
  const parts = speakerParts.length > 1 ? speakerParts : raw.split(/(?<=[.!?])\s+/);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0);
}

function stampLine(offsetSeconds: number, body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const stamped = text.match(STAMPED_LINE);
  if (stamped) return `[${stamped[1]}] ${stamped[2]!.trim()}`;
  return `[${stampClock(offsetSeconds)}] ${text}`;
}

/**
 * Timestamp every spoken line. Segment clocks from Whisper win when
 * present; otherwise each utterance is stamped at the slice start —
 * honest (we know the window) and enough for the side log to parse.
 */
export function formatTimestampedTranscript(
  text: string | null | undefined,
  opts?: { offsetSeconds?: number; segments?: Array<{ start?: number; text?: string | null }> },
): string {
  const offset = Math.max(0, Number(opts?.offsetSeconds) || 0);
  const segments = (opts?.segments ?? [])
    .map((seg) => ({
      start: Number(seg.start),
      text: String(seg.text || '').trim(),
    }))
    .filter((seg) => seg.text);

  if (segments.length) {
    return segments
      .map((seg) => stampLine(offset + (Number.isFinite(seg.start) ? seg.start : 0), seg.text))
      .filter(Boolean)
      .join('\n');
  }

  const raw = String(text || '').trim();
  if (!raw) return '';

  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length && lines.every((line) => STAMPED_LINE.test(line))) {
    return lines.map((line) => {
      const match = line.match(STAMPED_LINE);
      return match ? `[${match[1]}] ${match[2]!.trim()}` : line;
    }).join('\n');
  }

  const out: string[] = [];
  for (const line of lines) {
    const stamped = line.match(STAMPED_LINE);
    if (stamped) {
      out.push(`[${stamped[1]}] ${stamped[2]!.trim()}`);
      continue;
    }
    for (const piece of splitTranscriptUtterances(line)) {
      const next = stampLine(offset, piece);
      if (next) out.push(next);
    }
  }
  return out.join('\n');
}
