/**
 * Server-side grounding check for Ask answers.
 *
 * Runs after the model writes and before the answer is stored or sent. It is
 * local string matching against the same job data the model was given:
 * - quotes must match a transcript line (normalized case, punctuation, spacing)
 * - quote and source links must point at a real clip on this Ask's scope, at a
 *   time the quoted line was actually said
 * - times of day, dates, clip clocks, and job numbers must appear in the data
 * - names must be people or things on the file; people kept off the job only
 *   appear in an "isn't on this job" sentence (the @mention rule)
 * - a speaker role ("the homeowner said") must be on the file
 *
 * Trailer quotes and links are fixed or dropped here. Prose failures go back
 * to the model once (repair). If they still fail, the unsupported sentences
 * are removed and the answer says plainly what is not on file.
 */
import {
  clipsInScope,
  redactClipTranscriptForAsk,
  redactedLines,
  redactedClipSummary,
  spanIsRedacted,
  type AskLookupCatalog,
  type AskLookupClip,
} from './askLookup.js';
import { formatQuoteTrailer, parseMomentSource, parseQuoteTrailer, momentSourceId, type AskMomentQuote } from './askMoments.js';
import { prettyMentionStamp, sourceSlug } from './mentions.js';
import { isSpeechCountQuestion, speechCountContradictions, transcriptLineCount, transcriptLines } from './speechCount.js';

export type AskVerifyFailureKind =
  | 'quote'
  | 'quote_clip'
  | 'timestamp'
  | 'clip_ref'
  | 'time'
  | 'date'
  | 'clock'
  | 'name'
  | 'role'
  | 'record_ref'
  | 'speech_count'
  | 'yes_no'
  | 'count_missing'
  | 'timestamp_missing'
  | 'irrelevant'
  | 'transcript_dump'
  | 'unsupported_claim';

export type AskVerifyFailure = {
  kind: AskVerifyFailureKind;
  /** The exact text in the answer. */
  text: string;
  /** Why it failed, in words the repair prompt can act on. */
  detail: string;
  /** True when the check already fixed or dropped it (trailer quotes and links). */
  fixed?: boolean;
};

export type AskVerifyResult = {
  /** The answer with trailer quotes and links fixed or dropped. Prose is untouched. */
  answer: string;
  failures: AskVerifyFailure[];
  /** Failures in the prose that still need a repair or a strip. */
  open: AskVerifyFailure[];
  quotesChecked: number;
  quotesFailed: number;
  /**
   * Answer-shape problems (no number for a count, no time for a "when", off
   * topic, whole-transcript dump). Not strippable by sentence; logged and
   * passed to the repair step.
   */
  quality: AskVerifyFailure[];
};

export type AskVerifySource = {
  catalog: AskLookupCatalog;
  /** Everything else the model was shown this turn: mention supplement, tool and web blocks, tool trace. */
  extra?: string | null;
  /** The question. Only dates the user named are allowed from it. */
  question?: string | null;
  /** Clock for "today"; tests pin it. */
  now?: Date;
};

type TimedLine = { start: number | null; end: number | null; norm: string };
type ClipText = { clip: AskLookupClip; lines: TimedLine[]; joined: string; offsets: number[]; maxSecond: number };

const TRAILER_RE = /⟦(sources|quotes|followups|actions):[^⟧]*⟧/gi;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
const TIME_RE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s?m\b\.?/gi;
const CLOCK_RE = /(?<![\d:#$])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?![\d:])(?!\s*[ap]\.?\s?m\b)/gi;
const ROLE_RE =
  /\b(home ?owners?|property owners?|owners?|clients?|customers?|adjusters?|inspectors?|contractors?|foreman|superintendents?|tenants?|landlords?|property managers?)\s+(said|says|told|asked|mentioned|stated|explained|complained|wanted|requested|noted|agreed|confirmed|replied)\b/gi;
const JOB_NUMBER_RE = /\bjob\s*(?:number\s*|no\.?\s*)?#\s?(\d{1,7})\b/gi;
const CLIP_COUNT_RE = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:\w+\s+)?(clips|videos|recordings)\b/gi;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const SPEECH_VERBS = 'said|says|told|asked|mentioned|stated|explained|recorded|filmed|noted|called|emailed|texted|agreed|confirmed|replied|wrote|added';
const OFF_JOB_OK = /\b(?:isn['’]t|is not|aren['’]t|are not|wasn['’]t|was not|not)\s+(?:on|part of|assigned to|added to)\s+this\s+(?:job|file|project)\b|\bno access\b|\bdoesn['’]t have access\b|\boff this job\b/i;
/** Capitalized words that start sentences, headings, or labels; never a person's name by themselves. */
const COMMON_CAPS = new Set(
  (
    'a an the this that these those then there here on in at by for from to of and or but so yet if when where while after before since ' +
    'no yes not none one two three all any each every some most many few both either neither ' +
    'he she they we you i it his her their our your its my me him them us someone somebody anyone anybody everyone everybody nobody another other others ' +
    'monday tuesday wednesday thursday friday saturday sunday today yesterday tomorrow ' +
    'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'homeowner homeowners owner client customer adjuster inspector contractor crew office field site job project clip clips video videos ' +
    'summary note notes scope email estimate punch list open issues next step steps visit visits subject hi hello dear thanks thank best regards ' +
    'person speaker unknown seated standing man woman quote quotes source sources transcript file record history day date time ' +
    'what who why how which did does do is was were are be been has have had can could would should will may might must ' +
    'also still just only even however separately meanwhile overall again first second third last finally'
  ).split(/\s+/),
);

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

/** Lowercase, straight apostrophes dropped, punctuation to spaces, single spaces. */
export function normalizeForMatch(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsNorm(hay: string, needle: string): boolean {
  if (!needle) return true;
  return ` ${hay} `.includes(` ${needle} `);
}

function clipText(clip: AskLookupClip): ClipText {
  const lines: TimedLine[] = [];
  const segments = Array.isArray(clip.segments) ? clip.segments : [];
  if (segments.length) {
    for (const row of segments) {
      if (!row || !Number.isFinite(row.start)) continue;
      const end = Number.isFinite(row.end) ? row.end : row.start;
      // Same span-overlap rule as the rest of Ask: redacted speech is never a match.
      if (spanIsRedacted(clip, row.start, end)) continue;
      lines.push({ start: row.start, end, norm: normalizeForMatch(row.text) });
    }
  } else {
    const rows = redactedLines(redactClipTranscriptForAsk(clip));
    rows.forEach((row, index) => {
      const next = rows[index + 1]?.atSeconds ?? null;
      const text = row.text.replace(/^[^:]{1,40}:\s+/, '');
      if (/privacy redacted/i.test(text)) return;
      lines.push({ start: row.atSeconds, end: next ?? row.atSeconds, norm: normalizeForMatch(text) });
    });
  }
  const offsets: number[] = [];
  let joined = '';
  for (const line of lines) {
    offsets.push(joined.length + (joined ? 1 : 0));
    joined = joined ? `${joined} ${line.norm}` : line.norm;
  }
  const maxSecond = lines.reduce((max, line) => Math.max(max, line.end ?? 0, line.start ?? 0), 0);
  return { clip, lines, joined, offsets, maxSecond };
}

function lineAt(text: ClipText, offset: number): TimedLine | null {
  let found: TimedLine | null = null;
  for (let i = 0; i < text.lines.length; i += 1) {
    if (text.offsets[i]! <= offset) found = text.lines[i]!;
    else break;
  }
  return found;
}

/** Where a quote was said in one clip, or null. "…" splits a quote into parts that must all be in that clip. */
function findInClip(text: ClipText, quote: string): { line: TimedLine | null } | null {
  const parts = quote
    .split(/\.{3}|…/)
    .map((part) => normalizeForMatch(part))
    .filter(Boolean);
  if (!parts.length) return null;
  const hay = ` ${text.joined} `;
  let first = -1;
  for (const part of parts) {
    const at = hay.indexOf(` ${part} `);
    if (at < 0) return null;
    if (first < 0) first = at;
  }
  return { line: lineAt(text, Math.max(0, first)) };
}

function timeKey(hour: string, minute: string | undefined, half: string): string {
  return `${Number(hour)}:${minute ?? '00'}${half.toLowerCase()}`;
}

function monthIndex(name: string): number {
  const key = name.slice(0, 3).toLowerCase();
  return MONTHS.indexOf(key) + 1;
}

function collectDates(text: string, into: Set<string>): void {
  for (const match of text.matchAll(MONTH_RE)) {
    const month = monthIndex(match[1]!);
    const day = Number(match[2]);
    if (month && day >= 1 && day <= 31) into.add(`${month}-${day}`);
  }
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    into.add(`${Number(match[2])}-${Number(match[3])}`);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/((?:20)?\d{2}))?\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    // No year and a day of 1-12 is a fraction or a pitch (3/4, 5/8, 1/2, 5/4), not a calendar day.
    if (!match[3] && day <= 12) continue;
    into.add(`${month}-${day}`);
  }
}

function collectTimes(text: string, into: Set<string>): void {
  for (const match of text.matchAll(TIME_RE)) into.add(timeKey(match[1]!, match[2], match[3]!));
}

function clockSeconds(match: RegExpMatchArray): number {
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = match[3] == null ? null : Number(match[3]);
  return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
}

/** The job data this turn could be grounded in, pre-normalized for matching. */
export type AskGroundingIndex = {
  catalog: AskLookupCatalog;
  clips: ClipText[];
  /** Raw text: job context fields, clip titles, summaries, findings, history, extra blocks. */
  raw: string;
  norm: string;
  dates: Set<string>;
  times: Set<string>;
  clocks: number[];
  people: Array<{ name: string; norm: string; onThisJob: boolean }>;
  /** The question this turn, for the answer-shape checks. */
  question?: string | null;
};

export function buildGroundingIndex(source: AskVerifySource): AskGroundingIndex {
  const { catalog } = source;
  const zone = catalog.timeZone ?? null;
  const scoped = [...clipsInScope(catalog), ...(catalog.access === 'viewer' ? [] : catalog.orgClips ?? [])];
  const clips = scoped.map(clipText);
  const parts: string[] = [
    trim(catalog.jobTitle),
    trim(catalog.jobAddress),
    trim(catalog.clientName),
    trim(catalog.jobDescription),
  ];
  const dates = new Set<string>();
  const times = new Set<string>();
  const stamp = (value: string | null | undefined) => {
    const raw = trim(value);
    if (!raw) return;
    const pretty = prettyMentionStamp(raw, zone).stamp;
    if (pretty) parts.push(pretty);
  };
  for (const clip of scoped) {
    parts.push(trim(clip.title), trim(clip.jobTitle), redactedClipSummary(clip), (clip.speakers ?? []).join(', '));
    parts.push(redactClipTranscriptForAsk(clip));
    stamp(clip.workDate);
    stamp(clip.capturedAt);
  }
  for (const event of catalog.history ?? []) {
    parts.push(trim(event.summary));
    stamp(event.at);
  }
  const people = (catalog.people ?? [])
    .filter((person) => trim(person.name))
    .map((person) => ({ name: trim(person.name), norm: normalizeForMatch(person.name), onThisJob: person.onThisJob !== false }));
  for (const person of people) {
    if (person.onThisJob) parts.push(person.name);
  }
  if (source.extra) parts.push(source.extra);
  const raw = parts.filter(Boolean).join('\n');
  collectDates(raw, dates);
  if (source.question) collectDates(source.question, dates);
  const now = source.now ?? new Date();
  const today = prettyMentionStamp(now.toISOString(), zone).day;
  if (today) collectDates(today, dates);
  collectTimes(raw, times);
  const clocks: number[] = [];
  for (const text of clips) {
    for (const line of text.lines) if (line.start != null) clocks.push(line.start);
  }
  for (const match of raw.matchAll(/\[((?:\d+:)?\d{1,2}:\d{2})\]/g)) {
    const bits = match[1]!.split(':').map(Number);
    clocks.push(bits.length === 3 ? bits[0]! * 3600 + bits[1]! * 60 + bits[2]! : bits[0]! * 60 + bits[1]!);
  }
  return { catalog, clips, raw, norm: normalizeForMatch(raw), dates, times, clocks, people, question: source.question ?? null };
}

function splitTrailers(answer: string): { prose: string; trailers: string[] } {
  const trailers: string[] = [];
  const prose = answer.replace(TRAILER_RE, (match) => {
    trailers.push(match);
    return '';
  });
  return { prose: prose.replace(/\n{3,}/g, '\n\n').trim(), trailers };
}

function clipById(index: AskGroundingIndex, proofId: string): ClipText | null {
  return index.clips.find((text) => text.clip.proofId === proofId) ?? null;
}

function inWindow(line: TimedLine | null, seconds: number | null): boolean {
  if (!line || line.start == null) return seconds == null;
  if (seconds == null) return false;
  const end = Math.max(line.end ?? line.start, line.start);
  return seconds >= line.start - 1.5 && seconds <= end + 1.5;
}

function citeFor(text: ClipText, line: TimedLine | null, slug?: string | null): string {
  const clip = text.clip;
  return momentSourceId(clip.jobId, clip.proofId, slug || sourceSlug(clip.title), line?.start ?? null);
}

/** Fix or drop each trailer quote. Returns the kept quotes and what failed. */
function checkTrailerQuotes(
  index: AskGroundingIndex,
  quotes: AskMomentQuote[],
): { kept: AskMomentQuote[]; failures: AskVerifyFailure[] } {
  const kept: AskMomentQuote[] = [];
  const failures: AskVerifyFailure[] = [];
  for (const quote of quotes) {
    const moment = parseMomentSource(quote.sourceId);
    const cited = moment ? clipById(index, moment.proofId) : null;
    const inCited = cited ? findInClip(cited, quote.text) : null;
    if (cited && inCited) {
      if (moment!.atSeconds != null && !inWindow(inCited.line, moment!.atSeconds)) {
        const fixed = citeFor(cited, inCited.line, moment!.slug);
        failures.push({
          kind: 'timestamp',
          text: quote.sourceId,
          detail: `"${quote.text}" is said at ${inCited.line?.start ?? '?'}s in that clip, not ${moment!.atSeconds}s`,
          fixed: true,
        });
        kept.push({ ...quote, sourceId: fixed, atSeconds: inCited.line?.start ?? null });
      } else {
        kept.push(quote);
      }
      continue;
    }
    const elsewhere = index.clips
      .map((text) => ({ text, hit: findInClip(text, quote.text) }))
      .find((row) => row.hit);
    if (elsewhere) {
      const fixed = citeFor(elsewhere.text, elsewhere.hit!.line);
      failures.push({
        kind: 'quote_clip',
        text: quote.sourceId,
        detail: `"${quote.text}" is from a different clip`,
        fixed: true,
      });
      kept.push({ ...quote, sourceId: fixed, atSeconds: elsewhere.hit!.line?.start ?? null });
      continue;
    }
    failures.push({
      kind: 'quote',
      text: quote.text,
      detail: 'not said in any transcript on this file',
      fixed: true,
    });
  }
  return { kept, failures };
}

function checkSourceIds(index: AskGroundingIndex, trailer: string): { line: string; failures: AskVerifyFailure[] } {
  const body = trailer.replace(/^⟦sources:\s*/i, '').replace(/⟧$/, '');
  const failures: AskVerifyFailure[] = [];
  const kept: string[] = [];
  const jobIds = new Set([index.catalog.jobId, ...index.clips.map((text) => text.clip.jobId)].filter(Boolean) as string[]);
  const clipDays = new Set(index.clips.map((text) => trim(text.clip.workDate)).filter(Boolean));
  for (const raw of body.split(',').map((part) => part.trim()).filter(Boolean)) {
    if (raw.startsWith('video/')) {
      const moment = parseMomentSource(raw);
      const text = moment ? clipById(index, moment.proofId) : null;
      if (!moment || !text || text.clip.jobId !== moment.jobId) {
        failures.push({ kind: 'clip_ref', text: raw, detail: 'no such clip on this file', fixed: true });
        continue;
      }
      if (moment.atSeconds != null && text.maxSecond > 0 && moment.atSeconds > text.maxSecond + 2) {
        failures.push({ kind: 'timestamp', text: raw, detail: 'past the end of the clip', fixed: true });
        kept.push(momentSourceId(moment.jobId, moment.proofId, moment.slug, null));
        continue;
      }
      kept.push(raw);
      continue;
    }
    const clipDay = raw.match(/^clip:(\d{4}-\d{2}-\d{2})$/i);
    if (clipDay) {
      if (!clipDays.has(clipDay[1]!)) {
        failures.push({ kind: 'clip_ref', text: raw, detail: 'no clip filmed that day', fixed: true });
        continue;
      }
      kept.push(raw);
      continue;
    }
    const job = raw.match(/^job\/([0-9a-z-]+)\//i);
    if (job && !jobIds.has(job[1]!)) {
      failures.push({ kind: 'record_ref', text: raw, detail: 'not this job', fixed: true });
      continue;
    }
    kept.push(raw);
  }
  return { line: kept.length ? `⟦sources: ${[...new Set(kept)].join(', ')}⟧` : '', failures };
}

type ProseQuote = { text: string; full: string };

function proseQuotes(prose: string): ProseQuote[] {
  const out: ProseQuote[] = [];
  for (const match of prose.matchAll(/“([^”\n]{1,400})”|"([^"\n]{1,400})"/g)) {
    const text = trim(match[1] ?? match[2]);
    if (text) out.push({ text, full: match[0] });
  }
  return out;
}

function checkProseQuote(index: AskGroundingIndex, quote: ProseQuote): AskVerifyFailure | null {
  const norm = normalizeForMatch(quote.text);
  if (!norm) return null;
  const words = norm.split(' ').length;
  if (index.clips.some((text) => findInClip(text, quote.text))) return null;
  // Short labels ("RESTORE 365") and written records (notes, history, titles) may be quoted from the file text.
  const parts = quote.text.split(/\.{3}|…/).map((part) => normalizeForMatch(part)).filter(Boolean);
  if (parts.every((part) => containsNorm(index.norm, part))) return null;
  return {
    kind: 'quote',
    text: quote.full,
    detail: words >= 3 ? 'these words are not in any transcript or record on this file' : 'this label is not on the file',
  };
}

function checkDates(index: AskGroundingIndex, prose: string): AskVerifyFailure[] {
  const out: AskVerifyFailure[] = [];
  for (const match of prose.matchAll(MONTH_RE)) {
    const month = monthIndex(match[1]!);
    const day = Number(match[2]);
    if (!month || day < 1 || day > 31) continue;
    if (index.dates.has(`${month}-${day}`)) continue;
    out.push({ kind: 'date', text: match[0], detail: 'no clip, record, or history entry on this date' });
  }
  return out;
}

function checkTimes(index: AskGroundingIndex, prose: string): AskVerifyFailure[] {
  const out: AskVerifyFailure[] = [];
  for (const match of prose.matchAll(TIME_RE)) {
    const key = timeKey(match[1]!, match[2], match[3]!);
    if (index.times.has(key)) continue;
    out.push({ kind: 'time', text: match[0].trim(), detail: 'no clip or history entry at this time' });
  }
  for (const match of prose.matchAll(CLOCK_RE)) {
    const seconds = clockSeconds(match);
    if (index.clocks.some((at) => Math.abs(at - seconds) <= 2)) continue;
    out.push({ kind: 'clock', text: match[0], detail: 'nothing is said at this point in any clip' });
  }
  return out;
}

function checkRecordRefs(index: AskGroundingIndex, prose: string): AskVerifyFailure[] {
  const out: AskVerifyFailure[] = [];
  for (const match of prose.matchAll(JOB_NUMBER_RE)) {
    if (new RegExp(`#\\s?${match[1]}\\b`).test(index.raw)) continue;
    out.push({ kind: 'record_ref', text: match[0], detail: 'this job number is not on the file' });
  }
  const total = index.clips.filter((text) => !index.catalog.jobId || text.clip.jobId === index.catalog.jobId).length;
  for (const match of prose.matchAll(CLIP_COUNT_RE)) {
    const before = prose.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
    // "Sep 21 interior clips" is a date, not a count.
    if (/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i.test(before) || /[\d/:-]$/.test(before)) continue;
    const n = NUMBER_WORDS[match[1]!.toLowerCase()] ?? Number(match[1]);
    if (!Number.isFinite(n) || n <= total) continue;
    out.push({ kind: 'record_ref', text: match[0], detail: `the file has ${total} clip${total === 1 ? '' : 's'}` });
  }
  return out;
}

function sentences(prose: string): string[] {
  return prose
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=["“*([A-Z0-9-])/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function nameCandidates(sentence: string): string[] {
  const out: string[] = [];
  const cleaned = sentence.replace(/[*_`#>|]/g, ' ');
  const word = "[A-Z][a-z]+(?:['’-][A-Za-z]+)?";
  for (const match of cleaned.matchAll(new RegExp(`\\b(${word}(?:\\s+${word}){1,2})\\b`, 'g'))) {
    const words = match[1]!.split(/\s+/);
    while (words.length && COMMON_CAPS.has(words[0]!.toLowerCase())) words.shift();
    while (words.length && COMMON_CAPS.has(words[words.length - 1]!.toLowerCase())) words.pop();
    if (words.length >= 2) out.push(words.join(' '));
  }
  for (const match of cleaned.matchAll(new RegExp(`\\b(${word})\\s+(?:${SPEECH_VERBS})\\b`, 'g'))) {
    if (!COMMON_CAPS.has(match[1]!.toLowerCase())) out.push(match[1]!);
  }
  return [...new Set(out)];
}

function checkNames(index: AskGroundingIndex, prose: string): AskVerifyFailure[] {
  const out: AskVerifyFailure[] = [];
  for (const sentence of sentences(prose)) {
    if (/^\s*(?:#|\|)/.test(sentence)) continue;
    const norm = normalizeForMatch(sentence);
    for (const person of index.people) {
      if (person.onThisJob || !containsNorm(norm, person.norm)) continue;
      if (OFF_JOB_OK.test(sentence)) continue;
      out.push({ kind: 'name', text: person.name, detail: `${person.name} isn't on this job` });
    }
    for (const name of nameCandidates(sentence)) {
      const key = normalizeForMatch(name);
      if (containsNorm(index.norm, key)) continue;
      // People kept off the job are judged by the rule above, not as unknown names.
      if (index.people.some((person) => person.norm === key)) continue;
      const words = key.split(' ');
      if (words.length > 1 && words.every((part) => containsNorm(index.norm, part))) continue;
      out.push({ kind: 'name', text: name, detail: 'no one by this name is on the file' });
    }
  }
  return out;
}

function checkRoles(index: AskGroundingIndex, prose: string): AskVerifyFailure[] {
  const out: AskVerifyFailure[] = [];
  for (const match of prose.matchAll(ROLE_RE)) {
    const role = normalizeForMatch(match[1]!).replace(/s$/, '');
    const variants = [role, role.replace(' ', ''), role.replace(/^homeowner$/, 'home owner')];
    if (variants.some((variant) => containsNorm(index.norm, variant) || containsNorm(index.norm, `${variant}s`))) continue;
    out.push({ kind: 'role', text: match[0], detail: 'the file does not say anyone in this role spoke' });
  }
  return out;
}

/** Transcript lines on a clip: segments when stored, else stamped transcript lines. Null when no transcript. */
function clipLineCount(clip: AskLookupClip): number | null {
  const segments = Array.isArray(clip.segments) ? clip.segments.filter((row) => row && trim(row.text)) : [];
  if (segments.length) return segments.length;
  const transcript = trim(clip.transcript);
  return transcript ? transcriptLineCount(transcript) : null;
}

/**
 * Statements about how much was said ("the only speech is a single fragment",
 * "three lines") that no clip's raw transcript bears out. A sentence naming a
 * clip is checked against that clip; otherwise against every clip in scope
 * that has a transcript. The raw transcript wins over any AI summary.
 */
export function checkSpeechCounts(index: AskGroundingIndex, prose: string): AskVerifyFailure[] {
  const withCounts = index.clips
    .map((text) => ({ clip: text.clip, count: clipLineCount(text.clip) }))
    .filter((row): row is { clip: AskLookupClip; count: number } => row.count != null);
  if (!withCounts.length) return [];
  const out: AskVerifyFailure[] = [];
  for (const sentence of sentences(prose)) {
    const norm = normalizeForMatch(sentence);
    const named = withCounts.filter((row) => {
      const title = normalizeForMatch(row.clip.title);
      return title.length >= 4 && containsNorm(norm, title);
    });
    const candidates = named.length ? named : withCounts;
    for (const hit of speechCountContradictions(sentence, candidates.map((row) => row.count))) {
      const actual = hit.actual.length === 1 ? `${hit.actual[0]}` : hit.actual.join(' or ');
      out.push({
        kind: 'speech_count',
        text: hit.text,
        detail: `the raw transcript has ${actual} line${hit.actual.length === 1 && hit.actual[0] === 1 ? '' : 's'}; count speech from the transcript, not the AI summary`,
      });
    }
  }
  return out;
}

const QUALITY_STOP = new Set(
  (
    'the a an and or but of to in on at by for from with about into over is are was were be been being do does did has have had ' +
    'what when where who whom which why how any anything something someone anyone this that these those it its they them their there here ' +
    'clip clips video videos footage recording file job said say says talk talked mention mentioned tell told me you your i we our can could ' +
    'would should will just exactly exact quote quotes time times timestamp timestamps second seconds minute point moment happen happened ' +
    'show shows shown see seen visible please each every all many much some there ' +
    'list everything order first last give line lines spoken speak spoke words transcript whole entire full thing things'
  ).split(/\s+/),
);
const ABSTAIN_RE =
  /\b(not shown|not established|not on file|not in the (?:evidence|file|footage|transcript)|does(?:n['’]t| not) (?:show|mention|include|say)|never (?:mentions?|shows?|says?)|no (?:evidence|record|mention)|isn['’]t (?:shown|mentioned|on file)|can(?:no|['’])t (?:tell|confirm|give)|not (?:visible|mentioned|stated|confirmed))\b/i;
const NEGATION_RE = /\b(no|not|never|n['’]t|none|without|unclear|cannot|can['’]t|unconfirmed)\b/i;

function contentTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(' ')
    .filter((word) => word.length > 2 && !QUALITY_STOP.has(word) && !/^\d+$/.test(word));
}

function firstSentence(text: string): string {
  const body = splitTrailers(text).prose.replace(/⟦\/?artifact⟧/g, ' ').trim();
  return (body.split(/(?<=[.!?])\s+|\n/)[0] ?? '').trim();
}

function stemIn(norm: string, word: string): boolean {
  const w = normalizeForMatch(word);
  if (!w) return true;
  if (containsNorm(norm, w)) return true;
  const stem = w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w;
  return ` ${norm}`.includes(` ${stem}`);
}

export type AnswerQualityInput = {
  question: string;
  answer: string;
  /** One entry per clip in scope: its raw transcript lines. */
  transcripts: string[][];
  /** Normalized text of everything the answer may rely on (normalizeForMatch). */
  evidenceNorm: string;
};

/**
 * Post-generation checks on the answer as a whole: a yes/no answer that
 * contradicts itself, a count question with no number up front, a "when"
 * question with no time, an answer that does not address the question, a
 * whole-transcript dump for a narrow question, and work-completed / price /
 * commitment claims the evidence does not support. Pure; used by Ask and by
 * the eval harness.
 */
export function answerQualityFailures(input: AnswerQualityInput): AskVerifyFailure[] {
  const question = trim(input.question);
  const answer = trim(input.answer);
  if (!question || !answer) return [];
  const out: AskVerifyFailure[] = [];
  const lead = firstSentence(answer);
  const abstains = ABSTAIN_RE.test(answer);
  const q = question.toLowerCase();

  if (/^(did|does|do|is|are|was|were|has|have|had|can|could|will|would)\b/.test(q)) {
    // "Yes." / "No." is often its own sentence; judge it with the sentence after it.
    const body = splitTrailers(answer).prose.trim();
    const opening = (body.split('\n')[0] ?? '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    const yes = /^\**yes\b/i.test(opening);
    const no = /^\**no\b/i.test(opening);
    if (yes && ABSTAIN_RE.test(opening)) {
      out.push({ kind: 'yes_no', text: opening, detail: 'the answer says Yes and then says it is not shown' });
    } else if (no && /\b(yes|does show|is shown|is visible|clearly shows)\b/i.test(opening.replace(/^\**no\b/i, ''))) {
      out.push({ kind: 'yes_no', text: opening, detail: 'the answer says No and then says it is shown' });
    }
  }

  if (isSpeechCountQuestion(question) && !/\b(\d+|zero|no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(lead)) {
    out.push({ kind: 'count_missing', text: lead || answer.slice(0, 80), detail: 'a count question must give the number in the first sentence' });
  }

  if (/\b(when|what time|timestamp|at what point|how far in|what second|what minute)\b/.test(q) && !/\b\d{1,2}:\d{2}\b/.test(answer) && !abstains) {
    out.push({ kind: 'timestamp_missing', text: lead || answer.slice(0, 80), detail: 'the question asks when; give the [m:ss] time from the evidence or say it is not shown' });
  }

  const asked = [...new Set(contentTokens(question))];
  if (asked.length >= 2 && !abstains) {
    const said = normalizeForMatch(answer);
    if (!asked.some((word) => stemIn(said, word))) {
      out.push({ kind: 'irrelevant', text: lead || answer.slice(0, 80), detail: `the answer does not address ${asked.slice(0, 3).join(', ')}` });
    }
  }

  const wantsAll = /\b(full|whole|entire|every|each|all|list|everything|transcri(?:be|pt) (?:it|the clip))\b/.test(q) || isSpeechCountQuestion(question);
  if (!wantsAll && asked.length) {
    const said = normalizeForMatch(answer);
    for (const lines of input.transcripts) {
      const norms = lines.map((line) => normalizeForMatch(line.replace(/^\[[^\]]+\]\s*/, ''))).filter((line) => line.split(' ').length >= 2);
      if (norms.length < 4) continue;
      const shown = norms.filter((line) => containsNorm(said, line)).length;
      if (shown / norms.length >= 0.8) {
        out.push({ kind: 'transcript_dump', text: `${shown} of ${norms.length} transcript lines`, detail: 'a narrow question gets only the lines that answer it, not the whole transcript' });
        break;
      }
    }
  }

  const evidence = input.evidenceNorm;
  for (const sentence of sentences(splitTrailers(answer).prose)) {
    if (NEGATION_RE.test(sentence) || ABSTAIN_RE.test(sentence)) continue;
    for (const match of sentence.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\s?(?:dollars|bucks)\b/gi)) {
      const amount = (match[1] ?? match[2] ?? '').replace(/,/g, '');
      if (amount && !containsNorm(evidence, amount) && !containsNorm(evidence, normalizeForMatch(match[1] ?? match[2] ?? ''))) {
        out.push({ kind: 'unsupported_claim', text: match[0], detail: 'no such price or amount is on file' });
      }
    }
    const work = sentence.match(/\b(finished|completed|installed|replaced|repaired|fixed|patched|painted|removed)\s+(?:the\s+|a\s+|an\s+|all\s+)?([a-z][a-z-]+)/i);
    if (work && !(stemIn(evidence, work[1]!) && stemIn(evidence, work[2]!))) {
      out.push({ kind: 'unsupported_claim', text: work[0], detail: 'the evidence does not show this work being done' });
    }
    const promise = sentence.match(/\b(agreed to|promised to|committed to|will)\s+(come back|return|replace|fix|install|finish|pay|cover|repair|send)\b/i);
    if (promise && !stemIn(evidence, promise[2]!.split(' ')[0]!)) {
      out.push({ kind: 'unsupported_claim', text: promise[0], detail: 'no such commitment is on file' });
    }
  }
  return out;
}

function dedupeFailures(failures: AskVerifyFailure[]): AskVerifyFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.kind}:${failure.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Check one answer. Trailer quotes and links come back fixed; prose failures come back open. */
export function verifyAskAnswer(answer: string, index: AskGroundingIndex): AskVerifyResult {
  const { prose, trailers } = splitTrailers(answer);
  const failures: AskVerifyFailure[] = [];
  const outTrailers: string[] = [];
  let quotesChecked = 0;
  let quotesFailed = 0;
  for (const trailer of trailers) {
    if (/^⟦quotes:/i.test(trailer)) {
      const quotes = parseQuoteTrailer(`\n${trailer}`);
      quotesChecked += quotes.length;
      const checked = checkTrailerQuotes(index, quotes);
      quotesFailed += checked.failures.filter((failure) => failure.kind !== 'timestamp').length;
      failures.push(...checked.failures);
      const line = formatQuoteTrailer(checked.kept);
      if (line) outTrailers.push(line);
    } else if (/^⟦sources:/i.test(trailer)) {
      const checked = checkSourceIds(index, trailer);
      failures.push(...checked.failures);
      if (checked.line) outTrailers.push(checked.line);
    } else {
      outTrailers.push(trailer);
    }
  }
  const open: AskVerifyFailure[] = [];
  for (const quote of proseQuotes(prose)) {
    quotesChecked += 1;
    const failure = checkProseQuote(index, quote);
    if (failure) {
      quotesFailed += 1;
      open.push(failure);
    }
  }
  // Quoted words are checked as quotes; do not also read them as names or times.
  const unquoted = prose.replace(/“[^”\n]{1,400}”|"[^"\n]{1,400}"/g, ' ');
  open.push(
    ...checkDates(index, unquoted),
    ...checkTimes(index, unquoted),
    ...checkRecordRefs(index, unquoted),
    ...checkNames(index, unquoted),
    ...checkRoles(index, unquoted),
    ...checkSpeechCounts(index, unquoted),
    ...(index.question
      ? answerQualityFailures({
          question: index.question,
          answer: prose,
          transcripts: index.clips.map((text) => transcriptLines(redactClipTranscriptForAsk(text.clip))),
          evidenceNorm: index.norm,
        }).filter((failure) => failure.kind === 'unsupported_claim' || failure.kind === 'yes_no')
      : []),
  );
  const openDeduped = dedupeFailures(open);
  failures.push(...openDeduped);
  const quality = index.question
    ? answerQualityFailures({
        question: index.question,
        answer: prose,
        transcripts: index.clips.map((text) => transcriptLines(redactClipTranscriptForAsk(text.clip))),
        evidenceNorm: index.norm,
      }).filter((failure) => failure.kind !== 'unsupported_claim' && failure.kind !== 'yes_no')
    : [];
  const rebuilt = [prose, ...outTrailers].filter(Boolean).join('\n\n').trim();
  return { answer: rebuilt, failures, open: openDeduped, quotesChecked, quotesFailed, quality };
}

export const ASK_REPAIR_SYSTEM = `You correct a draft answer so every fact in it is supported by the source data.

Rules:
1. Use only the source data in this message. Do not use outside knowledge and do not guess.
2. Fix each listed failure. A quote must be the exact words from a transcript line, or be removed. A time, date, clip clock, job number, or name must be one that appears in the source data, or be removed.
3. When a fact is not in the source data, remove it and say plainly that it is not on file.
4. How much was said (how many lines, "only one fragment", "no speech") comes from the raw transcript lines, never from an AI summary. Fix any count that disagrees with the transcript.
5. Do not invent speaker roles such as homeowner, adjuster, or contractor. Use the name or label the source data gives.
6. Keep everything else as written, including the lines that start with ⟦ and end with ⟧.
7. Return only the corrected answer, with no preface.`;

export function formatRepairPrompt(input: { answer: string; failures: AskVerifyFailure[]; source: string }): string {
  const list = input.failures.map((failure) => `- ${failure.kind}: ${failure.text} — ${failure.detail}`).join('\n');
  return `Source data:\n${input.source.slice(0, 24_000)}\n\nFailures to fix:\n${list}\n\nDraft answer:\n${input.answer}`;
}

function failureLabel(failure: AskVerifyFailure): string {
  switch (failure.kind) {
    case 'quote':
      return `the quote ${/^["“]/.test(failure.text) ? failure.text : `"${failure.text}"`}`;
    case 'time':
    case 'clock':
      return `the time ${failure.text}`;
    case 'date':
      return `the date ${failure.text}`;
    case 'name':
      return failure.detail.includes("isn't on this job") ? `${failure.text} (not on this job)` : `the name ${failure.text}`;
    case 'role':
      return `who said it (${failure.text.split(/\s+/)[0]})`;
    case 'unsupported_claim':
      return `"${failure.text}" (${failure.detail})`;
    case 'speech_count':
      return `"${failure.text}" (${failure.detail.split(';')[0]})`;
    default:
      return failure.text;
  }
}

/**
 * Last resort: drop every sentence that carries a failing span and say what is
 * not on file. `fallback` is used when nothing supported is left.
 */
/** The prose left once sentences and bullets with a failing span are removed. */
export function supportedProse(answer: string, failures: AskVerifyFailure[]): string {
  const { prose } = splitTrailers(answer);
  const spans = failures.map((failure) => failure.text).filter(Boolean);
  const keptLines: string[] = [];
  for (const line of prose.split('\n')) {
    if (!line.trim()) {
      keptLines.push(line);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s/.test(line) || /^\s*\|/.test(line)) {
      if (!spans.some((span) => line.includes(span))) keptLines.push(line);
      continue;
    }
    const parts = line.split(/(?<=[.!?])\s+(?=["“*([A-Z0-9-])/);
    const kept = parts.filter((part) => !spans.some((span) => part.includes(span)));
    if (kept.length) keptLines.push(kept.join(' '));
  }
  const body = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return body.replace(/⟦artifact⟧\s*⟦\/artifact⟧/g, '').trim();
}

export function stripUnsupported(
  answer: string,
  failures: AskVerifyFailure[],
  fallback: string,
): string {
  const { trailers } = splitTrailers(answer);
  const body = supportedProse(answer, failures);
  const labels = [...new Set(failures.map(failureLabel))].slice(0, 6);
  const note = labels.length ? `Not on file, so I left it out: ${labels.join('; ')}.` : '';
  const substantive = normalizeForMatch(body.replace(/⟦\/?artifact⟧/g, '')).split(' ').filter(Boolean).length >= 6;
  const blocks = substantive ? [body, note] : [note, trim(fallback)];
  return [...blocks, ...trailers].filter(Boolean).join('\n\n').trim();
}
