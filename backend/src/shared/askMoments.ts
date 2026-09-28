/**
 * Moment citations for Ask.
 *
 * A clip citation can carry the seek time from transcript_segments / transcript_words:
 *   video/<jobId>/<proofId>/<slug>@<seconds>
 * Quotes and follow-ups ride in machine trailers the chat UI strips into chips.
 */

export type AskMomentQuote = {
  sourceId: string;
  speaker: string;
  text: string;
  atSeconds: number | null;
};

const QUOTES_RE = /(?:\n|^)\s*⟦quotes:\s*([^⟧]*)⟧\s*/i;
const FOLLOWUPS_RE = /(?:\n|^)\s*⟦followups:\s*([^⟧]*)⟧\s*/i;

export function formatAskClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function parseAskClock(stamp: string): number | null {
  const parts = stamp.split(':').map((part) => Number(part));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return null;
}

/** `video/…@12` or a bare video id. Seconds are omitted when the file has no timing. */
export function momentSourceId(
  jobId: string,
  proofId: string,
  slug: string,
  atSeconds?: number | null,
): string {
  const base = `video/${jobId}/${proofId}/${slug}`;
  if (atSeconds == null || !Number.isFinite(atSeconds) || atSeconds < 0) return base;
  const rounded = Math.round(atSeconds * 1000) / 1000;
  return `${base}@${rounded}`;
}

export function parseMomentSource(raw: string): {
  jobId: string;
  proofId: string;
  slug: string;
  atSeconds: number | null;
} | null {
  const token = String(raw ?? '').trim();
  const match = token.match(
    /^video\/([0-9a-z][0-9a-z-]{0,63})\/([0-9a-z][0-9a-z-]{0,63})\/([a-z0-9-]+)(?:@(\d+(?:\.\d+)?))?$/i,
  );
  if (!match) return null;
  const at = match[4] == null ? null : Number(match[4]);
  return {
    jobId: match[1]!,
    proofId: match[2]!,
    slug: match[3]!,
    atSeconds: at != null && Number.isFinite(at) ? at : null,
  };
}

function cleanTrailerText(value: string, cap: number): string {
  return value.replace(/[|⟧⟦]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);
}

export function formatQuoteTrailer(quotes: AskMomentQuote[]): string {
  const parts = quotes
    .filter((quote) => quote.sourceId && quote.text)
    .slice(0, 3)
    .map((quote) => {
      const speaker = cleanTrailerText(quote.speaker || 'Speaker', 40) || 'Speaker';
      const text = cleanTrailerText(quote.text, 180);
      return `${quote.sourceId}|${speaker}|${text}`;
    });
  if (!parts.length) return '';
  return `⟦quotes: ${parts.join(' ;; ')}⟧`;
}

export function parseQuoteTrailer(raw: string): AskMomentQuote[] {
  const match = String(raw ?? '').match(QUOTES_RE);
  if (!match) return [];
  const out: AskMomentQuote[] = [];
  for (const part of (match[1] ?? '').split(/\s*;;\s*/)) {
    const [sourceId, speaker, ...rest] = part.split('|');
    const text = rest.join('|').trim();
    const id = String(sourceId ?? '').trim();
    if (!id || !text) continue;
    const moment = parseMomentSource(id);
    out.push({
      sourceId: id,
      speaker: String(speaker ?? '').trim() || 'Speaker',
      text: text.slice(0, 180),
      atSeconds: moment?.atSeconds ?? null,
    });
  }
  return out;
}

export function formatFollowupTrailer(questions: string[]): string {
  const unique: string[] = [];
  for (const question of questions) {
    const text = cleanTrailerText(question, 140).replace(/[?]+$/, '?');
    if (!text || unique.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
    unique.push(text.endsWith('?') ? text : `${text}?`);
    if (unique.length >= 3) break;
  }
  if (unique.length < 2) return '';
  return `⟦followups: ${unique.join(' ;; ')}⟧`;
}

export function parseFollowupTrailer(raw: string): string[] {
  const match = String(raw ?? '').match(FOLLOWUPS_RE);
  if (!match) return [];
  const out: string[] = [];
  for (const part of (match[1] ?? '').split(/\s*;;\s*/)) {
    const text = part.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push(text.endsWith('?') ? text : `${text}?`);
    if (out.length >= 3) break;
  }
  return out;
}

export function stripMomentTrailers(raw: string): string {
  return String(raw ?? '')
    .replace(QUOTES_RE, '\n')
    .replace(FOLLOWUPS_RE, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
