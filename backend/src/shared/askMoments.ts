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
  /** Clip name shown on the quote card. Rides as a trailing `|clip=` field. */
  clipTitle?: string | null;
};

import { speakerLabelOrUnidentified } from './askSpeakers.js';

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

const ASK_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export type AskCalendarDate = { month: number; day: number; year: number | null };

/** A calendar day named in a question, such as "Sep 21" or "2026-09-17". */
export function parseAskDate(question: string): AskCalendarDate | null {
  const text = question.replace(/@/g, ' ');
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year: Number(iso[1]), month, day };
    }
  }
  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i,
  );
  if (named) {
    const month = ASK_MONTHS[named[1]!.slice(0, 3).toLowerCase()];
    const day = Number(named[2]);
    if (month && day >= 1 && day <= 31) {
      return { month, day, year: named[3] ? Number(named[3]) : null };
    }
  }
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { month, day, year: slash[3] ? Number(slash[3]) : null };
    }
  }
  return null;
}

export function formatAskDate(asked: AskCalendarDate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${months[asked.month - 1] ?? asked.month} ${asked.day}`;
  return asked.year ? `${label}, ${asked.year}` : label;
}

function calendarYmd(
  value: string | null | undefined,
  timeZone?: string | null,
): { y: number; m: number; d: number } | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return { y: Number(dateOnly[1]), m: Number(dateOnly[2]), d: Number(dateOnly[3]) };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  let zone = (timeZone ?? '').trim() || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
  } catch {
    zone = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const y = num('year');
  const m = num('month');
  const d = num('day');
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** True when a clip's work date is the day the question asked about, in the asker's zone. */
export function clipMatchesAskDate(
  workDate: string | null | undefined,
  asked: AskCalendarDate,
  timeZone?: string | null,
): boolean {
  const ymd = calendarYmd(workDate, timeZone);
  if (!ymd) return false;
  if (asked.year != null && ymd.y !== asked.year) return false;
  return ymd.m === asked.month && ymd.d === asked.day;
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
    .slice(0, 4)
    .map((quote) => {
      const speaker = cleanTrailerText(speakerLabelOrUnidentified(quote.speaker), 40);
      const text = cleanTrailerText(quote.text, 180);
      const clip = cleanTrailerText(String(quote.clipTitle ?? '').replace(/;;/g, ' '), 80);
      return `${quote.sourceId}|${speaker}|${text}${clip ? `|clip=${clip}` : ''}`;
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
    const clipField = rest.length > 1 && /^clip=/.test(rest[rest.length - 1] ?? '') ? rest.pop()! : '';
    const text = rest.join('|').trim();
    const id = String(sourceId ?? '').trim();
    if (!id || !text) continue;
    const moment = parseMomentSource(id);
    const clipTitle = clipField.replace(/^clip=/, '').trim();
    out.push({
      sourceId: id,
      speaker: speakerLabelOrUnidentified(speaker),
      text: text.slice(0, 180),
      atSeconds: moment?.atSeconds ?? null,
      ...(clipTitle ? { clipTitle } : {}),
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
