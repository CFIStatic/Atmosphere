/**
 * Turn lookup results into a project-manager answer.
 *
 * The first sentence is the result. A request to produce something
 * (summary, scope note, comparison, issues, punch list) becomes a finished
 * note the chat can copy. Visible prose never carries ids, UTC, or filler.
 */
import { cleanMentionTitle, prettyMentionStamp } from './mentions.js';
import { isLongMemoryQuestion, recallLongMemory, type LongThreadMemory } from './askMemory.js';
import { clipAskPreview, type AskLookupCatalog, type AskLookupClip, type AskLookupTraceStep } from './askLookup.js';
import {
  clipMatchesAskDate,
  formatAskDate,
  parseAskDate,
  type AskMomentQuote,
} from './askMoments.js';

export type AskTaskKind = 'summary' | 'scope' | 'compare' | 'issues' | 'punch' | 'note';

export type AskIntent = { kind: 'question' } | { kind: 'task'; task: AskTaskKind };

const FILLER_RE =
  /^(?:\s*)(?:certainly|great question|sure thing|of course|absolutely|happy to help|i(?:'|’)d be happy to)[!.,:\s-]*/i;

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const VIDEO_ID_RE = /video\/[0-9a-z-]+\/[0-9a-z-]+\/[^\s,⟧|]*/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;

export function classifyAskIntent(question: string): AskIntent {
  const q = question.toLowerCase();
  if (/\bpunch\s*-?\s*list\b|\bpunchlist\b/.test(q)) return { kind: 'task', task: 'punch' };
  if (/\bopen issues?\b|\boutstanding\b|\bstill open\b/.test(q)) return { kind: 'task', task: 'issues' };
  if (/\bcompare\b|\bversus\b|\bvs\.?\b|\bdifference between\b|\btwo visits\b/.test(q)) return { kind: 'task', task: 'compare' };
  if (/\bscope\b/.test(q) && /\b(draft|write|note|make|prepare)\b/.test(q)) return { kind: 'task', task: 'scope' };
  if (/\b(summary|summarize)\b/.test(q) || /\b(write|draft)\b[\s\S]{0,40}\b(homeowner|client|customer)\b/.test(q)) {
    return { kind: 'task', task: 'summary' };
  }
  if (/\b(write|draft|make|prepare|compose)\b/.test(q)) return { kind: 'task', task: 'note' };
  return { kind: 'question' };
}

export function localStamp(value: string | null | undefined, timeZone?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  return prettyMentionStamp(raw, timeZone).stamp || raw;
}

/** Strip filler, ids, raw clip ids, and UTC timestamps from text the reader sees. */
export function polishAskProse(
  input: string,
  opts?: { timeZone?: string | null; jobTitle?: string | null },
): string {
  let text = String(input ?? '');
  text = text.replace(FILLER_RE, '');
  text = text.replace(ISO_RE, (stamp) => localStamp(stamp, opts?.timeZone) || stamp);
  text = text.replace(/\bUTC\b/g, '');
  text = text.replace(VIDEO_ID_RE, '');
  text = text.replace(UUID_RE, '');
  const title = String(opts?.jobTitle ?? '').trim();
  if (title.length > 2) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(${escaped})(?:\\s*[—,:\\-]\\s*\\1)+`, 'gi'), '$1');
  }
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

export function wrapTaskArtifact(text: string): string {
  if (/⟦artifact⟧/.test(text)) return text;
  const parts = text.split(/\n\n/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return text;
  return `${parts[0]}\n\n⟦artifact⟧\n${parts.slice(1).join('\n\n')}\n⟦/artifact⟧`;
}

type ClipFact = {
  title: string;
  workDate: string | null;
  summary: string;
  cite: string;
};

type HistoryFact = { summary: string; at: string };

function dataOf(step: AskLookupTraceStep): Record<string, unknown> {
  const data = step.result.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function oneLine(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return clean;
  const sentence = clean.split(/(?<=\.)\s/)[0] ?? clean;
  return sentence.length <= 180 ? sentence : `${clean.slice(0, 157).trim()}…`;
}

function clipFact(row: Record<string, unknown>): ClipFact | null {
  const title = cleanMentionTitle(String(row.title ?? ''));
  if (!title) return null;
  return {
    title,
    workDate: row.workDate ? String(row.workDate) : null,
    summary: oneLine(String(row.summary ?? '').trim()),
    cite: String(row.cite ?? ''),
  };
}

function clipsFromTrace(trace: AskLookupTraceStep[]): ClipFact[] {
  const clips: ClipFact[] = [];
  const seen = new Set<string>();
  const push = (fact: ClipFact | null) => {
    if (!fact) return;
    const key = fact.cite || fact.title;
    if (seen.has(key)) return;
    seen.add(key);
    clips.push(fact);
  };
  for (const step of trace) {
    if (!step.result.ok) continue;
    const data = dataOf(step);
    if (step.tool === 'list_person_activity' && data.onThisJob === false) continue;
    if (step.tool === 'list_person_activity' && Array.isArray(data.clips)) {
      for (const row of data.clips) {
        if (row && typeof row === 'object') push(clipFact(row as Record<string, unknown>));
      }
    }
    if (step.tool === 'get_clip') push(clipFact(data));
  }
  return clips.sort((a, b) => String(a.workDate ?? '').localeCompare(String(b.workDate ?? '')));
}

function historyFromTrace(trace: AskLookupTraceStep[], timeZone?: string | null): HistoryFact[] {
  const events: HistoryFact[] = [];
  for (const step of trace) {
    if (step.tool !== 'read_job_history' || !step.result.ok) continue;
    const rows = dataOf(step).events;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const summary = String((row as { summary?: unknown }).summary ?? '').trim();
      if (!summary) continue;
      const at = localStamp(String((row as { at?: unknown }).at ?? ''), timeZone);
      events.push({ summary, at });
    }
  }
  return events;
}

function dateLabel(workDate: string | null, timeZone?: string | null): string {
  if (!workDate) return 'Undated';
  return localStamp(workDate, timeZone) || workDate;
}

function bullet(clip: ClipFact, timeZone?: string | null): string {
  const when = dateLabel(clip.workDate, timeZone);
  const title = clip.title.toLowerCase().startsWith(when.toLowerCase())
    ? clip.title.slice(when.length).replace(/^[\s—-]+/, '')
    : clip.title;
  const detail = clip.summary ? `. ${clip.summary}` : '';
  return `- **${when} — ${title}**${detail}`;
}

function clipCountLead(count: number): string {
  return count === 1 ? 'There is **1 clip** on this file.' : `There are **${count} clips** on this file.`;
}

function openedLine(events: HistoryFact[]): string {
  const opened = events.find((event) => /\bopened\b/i.test(event.summary));
  if (!opened) return '';
  return opened.at ? ` The file was opened ${opened.at}.` : ` ${opened.summary}.`;
}

function artifact(body: string): string {
  return `⟦artifact⟧\n${body.trim()}\n⟦/artifact⟧`;
}

function jobName(catalog: AskLookupCatalog): string {
  return cleanMentionTitle(catalog.jobTitle ?? '') || 'this job';
}

/** A broad "what is this job" question, not a search for one missing fact. */
export function isJobOverview(question: string): boolean {
  return /\b(?:what was this (?:job|file|project) about|what(?:'s| is| was) this (?:job|file) about|summar(?:y|ize|ise) this (?:job|file|project)|what was this about|tell me about this (?:job|file|project)|overview of this (?:job|file))\b/i.test(
    question,
  );
}

function catalogClips(catalog: AskLookupCatalog): AskLookupClip[] {
  return (catalog.clips ?? []).filter(
    (clip) => clip.orgId === catalog.orgId && (!catalog.jobId || clip.jobId === catalog.jobId),
  );
}

function catalogVisitFacts(catalog: AskLookupCatalog): ClipFact[] {
  return catalogClips(catalog)
    .slice()
    .sort((a, b) => String(a.workDate ?? '').localeCompare(String(b.workDate ?? '')))
    .map((clip) => ({
      title: cleanMentionTitle(clip.title) || 'Clip',
      workDate: clip.workDate ?? null,
      summary: oneLine(clipAskPreview(clip).summary),
      cite: clip.proofId,
    }));
}

function clearestLine(transcript: string): string {
  const lines = transcript
    .split('\n')
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter((line) => line && !/\[privacy redacted\]/i.test(line));
  return [...lines].sort((a, b) => b.length - a.length)[0]?.slice(0, 160) ?? '';
}

/** Overview written from the whole job, not from a failed keyword search. */
export function composeJobOverview(catalog: AskLookupCatalog): string {
  const name = jobName(catalog);
  const client = String(catalog.clientName ?? '').trim();
  const address = String(catalog.jobAddress ?? '').trim();
  const description = String(catalog.jobDescription ?? '').trim();
  const people = (catalog.people ?? []).filter((person) => person.onThisJob !== false && person.name).map((person) => person.name);
  const sentence = (label: string, value: string) => {
    const text = `${label}: ${value.trim()}`;
    return /[.!?]$/.test(text) ? text : `${text}.`;
  };
  const intro = [`**${name}** is the job on this file.`];
  if (client) intro.push(sentence('Client', client));
  if (address) intro.push(sentence('Address', address));
  if (description) intro.push(/[.!?]$/.test(description) ? description : `${description}.`);
  if (people.length) intro.push(`People on the job: ${people.join(', ')}.`);
  const clips = catalogClips(catalog).slice().sort((a, b) => String(a.workDate ?? '').localeCompare(String(b.workDate ?? '')));
  const visits = clips.map((clip) => {
    const when = dateLabel(clip.workDate ?? null, catalog.timeZone);
    const title = cleanMentionTitle(clip.title) || 'Clip';
    const preview = clipAskPreview(clip);
    const summary = preview.summary.trim();
    const speech = clearestLine(preview.transcript);
    const detail = [summary, speech ? `Said: “${speech}”` : ''].filter(Boolean).join(' ');
    return `- **${when} — ${title}**.${detail ? ` ${detail}` : ''}`;
  });
  const history = (catalog.history ?? []).slice(0, 4).map((event) => {
    const when = localStamp(event.at, catalog.timeZone);
    return `- ${when || 'Recorded'}: ${event.summary}`;
  });
  return [
    intro.join(' '),
    visits.length ? visits.join('\n') : 'No clips are on this file yet.',
    history.length ? `Job history:\n${history.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

type AskMemoryTurn = { role?: string | null; text?: string | null };

function recentPerson(turns: AskMemoryTurn[], catalog: AskLookupCatalog): string | null {
  const people = [...(catalog.people ?? [])].filter((person) => person.name).sort((a, b) => b.name.length - a.name.length);
  for (const turn of [...turns].reverse()) {
    const hay = String(turn.text ?? '').toLowerCase();
    const found = people.find((person) => hay.includes(person.name.toLowerCase()));
    if (found) return found.name;
  }
  return null;
}

function allAskDates(text: string): Array<{ month: number; day: number; year: number | null }> {
  const found: Array<{ month: number; day: number; year: number | null }> = [];
  const re =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/gi;
  for (const match of text.matchAll(re)) {
    const parsed = parseAskDate(match[0]);
    if (!parsed) continue;
    if (found.some((date) => date.month === parsed.month && date.day === parsed.day && date.year === parsed.year)) continue;
    found.push(parsed);
  }
  return found;
}

/** A turn that names one day. A list of several days does not pin the thread to the first. */
function recentDate(turns: AskMemoryTurn[]) {
  for (const turn of [...turns].reverse()) {
    const dates = allAskDates(String(turn.text ?? ''));
    if (dates.length === 1) return dates[0]!;
  }
  return null;
}

/**
 * Rewrite a short follow-up so pronouns, "and on Sep 21?", and "the first visit"
 * point at the person, date, and clips from earlier in the thread.
 */
function soleOnJobPerson(catalog: AskLookupCatalog): string | null {
  const names = (catalog.people ?? []).filter((person) => person.onThisJob !== false && person.name).map((person) => person.name);
  return names.length === 1 ? names[0]! : null;
}

/** The user is disputing the last answer, not asking a new question. */
export function isCorrection(question: string): boolean {
  return /\b(?:that(?:'s| is) wrong|you(?:'re| are) wrong|incorrect|not right|you got\b.+\bwrong|never (?:mentioned|said)|didn'?t say|did not say)\b/i.test(
    question,
  );
}

function isBareDateReply(question: string): boolean {
  const asked = parseAskDate(question);
  if (!asked) return false;
  const stripped = question
    .replace(/\b(?:on|the|please|just|visit|day)\b/gi, '')
    .replace(/[?.!,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 0 && stripped.length <= 18;
}

export function resolveAskQuestion(
  question: string,
  history: AskMemoryTurn[] | null | undefined,
  catalog: AskLookupCatalog,
): string {
  const q = question.trim();
  if (isLongMemoryQuestion(q)) return q;
  const turns = (history ?? []).filter((turn) => String(turn.text ?? '').trim()).slice(-8);
  if (!turns.length) return question;
  if (isCorrection(q)) return q;
  const person = recentPerson(turns, catalog) || soleOnJobPerson(catalog);
  const namedHere = (catalog.people ?? []).some((row) => row.name && q.toLowerCase().includes(row.name.toLowerCase()));
  const asked = parseAskDate(q);
  const prevDate = recentDate(turns);
  const prevUser = [...turns].reverse().find((turn) => turn.role !== 'assistant');
  const prevAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
  const prevSpeech = /\b(say|said|quote|tell|mention)\b/i.test(String(prevUser?.text ?? ''));
  const assistantAsked = /\b(which (?:day|clip|visit)|do you want|which one)\b/i.test(String(prevAssistant?.text ?? ''));

  if (/\bi meant\b/i.test(q) && asked && person) {
    return `What did ${person} say on ${formatAskDate(asked)}?`;
  }
  if ((assistantAsked || prevSpeech) && isBareDateReply(q) && asked && person && !/\b(compare|versus|why|think|wrong)\b/i.test(q)) {
    return `What did ${person} say on ${formatAskDate(asked)}?`;
  }
  if (!asked && prevDate && person && /\b(he|she|him|her|they)\b/i.test(q) && /\b(say|said)\b/i.test(q)) {
    return `What did ${person} say on ${formatAskDate(prevDate)}?`;
  }

  if (/^(?:and\b|what about\b)\s+/i.test(q) && asked && person && !namedHere && prevSpeech) {
    return `What did ${person} say on ${formatAskDate(asked)}?`;
  }
  if (/\bcompare\b/i.test(q) && /\bfirst visit\b/i.test(q) && /\b(that|this|it|there)\b/i.test(q)) {
    const dates = [
      ...new Set(
        catalogClips(catalog)
          .map((clip) => clip.workDate)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    const firstParsed = dates[0] ? parseAskDate(dates[0]) : null;
    const firstLabel = firstParsed ? formatAskDate(firstParsed) : dates[0] || 'the first visit';
    const subject = prevDate ? formatAskDate(prevDate) : 'the visit just discussed';
    return `compare ${subject} to the first visit on ${firstLabel}`;
  }
  if (!namedHere && person && /\b(he|she|him|her|they)\b/i.test(q)) {
    let next = q.replace(/\b(he|she|him|her|they)\b/gi, person);
    if (/\bthere\b/i.test(next) && prevDate && !asked) {
      next = next.replace(/\bthere\b/gi, `on ${formatAskDate(prevDate)}`);
    }
    return next;
  }
  return question;
}

function personBlock(trace: AskLookupTraceStep[]): { name: string; offJob: string | null } | null {
  for (const step of trace) {
    if (step.tool !== 'list_person_activity' || !step.result.ok) continue;
    const data = dataOf(step);
    const name = String(data.name ?? '').trim();
    if (data.onThisJob === false) return { name, offJob: step.result.summary };
    if (name) return { name, offJob: null };
  }
  return null;
}

function speechFromClip(trace: AskLookupTraceStep[]): Array<{ excerpt: string; speaker: string; atSeconds: number | null }> {
  const hits: Array<{ excerpt: string; speaker: string; atSeconds: number | null }> = [];
  for (const step of trace) {
    if (step.tool !== 'get_clip' || !step.result.ok) continue;
    const transcript = String(dataOf(step).transcript ?? '');
    for (const raw of transcript.split('\n')) {
      const line = raw.trim();
      if (!line || /\[privacy redacted\]/i.test(line)) continue;
      const clock = line.match(/^\[(\d+):(\d{2})\]\s*(.*)$/);
      const text = (clock ? clock[3] : line).replace(/^[^:]{1,40}:\s+/, '').trim();
      if (!text) continue;
      const speakers = dataOf(step).speakers;
      const speaker = Array.isArray(speakers) ? String(speakers[0] ?? '').trim() : '';
      hits.push({
        excerpt: text,
        speaker: speaker || 'Speaker',
        atSeconds: clock ? Number(clock[1]) * 60 + Number(clock[2]) : null,
      });
      break;
    }
  }
  return hits;
}

function searchHits(trace: AskLookupTraceStep[]): Array<{ excerpt: string; speaker: string; atSeconds: number | null }> {
  const hits: Array<{ excerpt: string; speaker: string; atSeconds: number | null }> = [];
  for (const step of trace) {
    if (step.tool !== 'search_transcripts' || !step.result.ok) continue;
    const rows = dataOf(step).hits;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const excerpt = String((row as { excerpt?: unknown }).excerpt ?? '').trim();
      if (!excerpt) continue;
      const at = (row as { atSeconds?: unknown }).atSeconds;
      hits.push({
        excerpt,
        speaker: String((row as { speaker?: unknown }).speaker ?? '').trim() || 'Speaker',
        atSeconds: at == null || Number.isNaN(Number(at)) ? null : Number(at),
      });
    }
  }
  return hits;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type SpeechMomentPick = {
  excerpt: string;
  atSeconds: number | null;
  proofId?: string;
  speaker?: string;
  cite?: string;
  title?: string;
};

/** A few substantive lines, spread across clips, including a later timestamp when one exists. */
export function selectSpeechMoments<T extends SpeechMomentPick>(moments: T[], limit = 4): T[] {
  const clear = moments.filter((moment) => moment.excerpt && !/\[privacy redacted\]/i.test(moment.excerpt));
  const score = (moment: T) => moment.excerpt.split(/\s+/).filter(Boolean).length;
  const picked: T[] = [];
  const byClip = new Map<string, T[]>();
  for (const moment of clear) {
    const key = moment.proofId || 'clip';
    const rows = byClip.get(key) ?? [];
    rows.push(moment);
    byClip.set(key, rows);
  }
  for (const rows of byClip.values()) {
    const best = [...rows].sort((a, b) => score(b) - score(a) || (a.atSeconds ?? 0) - (b.atSeconds ?? 0))[0];
    if (best) picked.push(best);
  }
  const ranked = [...clear].sort((a, b) => score(b) - score(a) || (a.atSeconds ?? 0) - (b.atSeconds ?? 0));
  for (const moment of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(moment)) picked.push(moment);
  }
  const later = [...clear]
    .filter((moment) => (moment.atSeconds ?? 0) >= 10)
    .sort((a, b) => score(b) - score(a))[0];
  if (later && !picked.includes(later)) {
    if (picked.length >= limit) picked[picked.length - 1] = later;
    else picked.push(later);
  }
  return picked
    .slice(0, limit)
    .sort((a, b) => (a.atSeconds ?? -1) - (b.atSeconds ?? -1) || a.excerpt.localeCompare(b.excerpt));
}

function fileContext(trace: AskLookupTraceStep[], catalog: AskLookupCatalog): string {
  const clips = clipsFromTrace(trace);
  if (clips.length) return clips.map((clip) => bullet(clip, catalog.timeZone)).join('\n');
  const events = historyFromTrace(trace, catalog.timeZone);
  if (events[0]) return `Job history shows ${events[0].summary.replace(/\.$/, '')}${events[0].at ? ` on ${events[0].at}` : ''}.`;
  const titles = (catalog.clips ?? [])
    .filter((clip) => clip.orgId === catalog.orgId && (!catalog.jobId || clip.jobId === catalog.jobId))
    .map((clip) => cleanMentionTitle(clip.title))
    .filter(Boolean)
    .slice(0, 4);
  if (titles.length) return `On file: ${titles.join('; ')}.`;
  return 'Nothing else is recorded on this file.';
}

function missingLine(question: string, trace: AskLookupTraceStep[], catalog: AskLookupCatalog): string {
  if (/\bpermit\b/i.test(question)) return 'This file does not include a permit number.';
  if (/\block\s?box\b|\bcode\b/i.test(question)) return 'This file does not include that code.';
  return `This file does not have that.\n\n${fileContext(trace, catalog)}`;
}

type DatedMoment = SpeechMomentPick & { speaker: string; title: string; workDate: string | null };

function spokenClips(trace: AskLookupTraceStep[]): Array<{
  proofId: string;
  title: string;
  workDate: string | null;
  moments: DatedMoment[];
}> {
  const clips: Array<{ proofId: string; title: string; workDate: string | null; moments: DatedMoment[] }> = [];
  for (const step of trace) {
    if (step.tool !== 'get_clip' || !step.result.ok) continue;
    const data = dataOf(step);
    const proofId = String(data.proofId ?? '');
    const title = cleanMentionTitle(String(data.title ?? '')) || 'Clip';
    const workDate = data.workDate ? String(data.workDate) : null;
    const raw = Array.isArray(data.moments) ? data.moments : [];
    const moments: DatedMoment[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const excerpt = String(rec.excerpt ?? '').trim();
      if (!excerpt || /\[privacy redacted\]/i.test(excerpt)) continue;
      const at = rec.atSeconds == null || Number.isNaN(Number(rec.atSeconds)) ? null : Number(rec.atSeconds);
      moments.push({
        excerpt,
        speaker: String(rec.speaker ?? '').trim() || 'Speaker',
        atSeconds: at,
        cite: String(rec.cite ?? ''),
        proofId,
        title,
        workDate,
      });
    }
    clips.push({ proofId, title, workDate, moments });
  }
  return clips;
}

function quoteBullet(moment: DatedMoment, showTitle: boolean): string {
  const when = moment.atSeconds == null ? '' : `At ${clock(moment.atSeconds)}, `;
  const where = showTitle ? ` (${moment.title})` : '';
  return `- ${when}${moment.speaker} said “${moment.excerpt}”${where}`;
}

function composeDatedSpeech(
  question: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
): string | null {
  if (!/\b(say|said|quote|tell|mention)\b/i.test(question)) return null;
  const asked = parseAskDate(question);
  if (!asked) return null;
  const person = personBlock(trace);
  if (person?.offJob) return person.offJob;
  const clips = spokenClips(trace);
  if (!clips.length) return null;
  const onDate = clips.filter((clip) => clipMatchesAskDate(clip.workDate, asked, catalog.timeZone));
  const others = clips.filter((clip) => !onDate.includes(clip));
  const label = formatAskDate(asked);
  const who = person?.name ? `**${person.name}**` : 'The recording';
  const datedMoments = onDate.flatMap((clip) => clip.moments);
  const timed = datedMoments.filter((moment) => moment.atSeconds != null);
  if (timed.length) {
    const key = selectSpeechMoments(timed);
    const showTitle = onDate.length > 1;
    const lines = key.map((moment) => quoteBullet(moment, showTitle));
    return `${who} on ${label} said:\n\n${lines.join('\n')}`;
  }
  const untimed = datedMoments.filter((moment) => moment.atSeconds == null && moment.excerpt);
  if (onDate.length) {
    const only = untimed.length === 1 ? untimed[0] : null;
    const lead = only
      ? `The ${label} clip has only one short untimed line (“${only.excerpt}”) and no timed speech.`
      : untimed.length
        ? `The ${label} clip has untimed text (“${untimed.map((moment) => moment.excerpt).join(' ')}”) and no timed speech.`
        : `The ${label} clip has no transcript text and no timed speech.`;
    const otherMoments = others.flatMap((clip) => clip.moments).filter((moment) => moment.atSeconds != null);
    const key = selectSpeechMoments(otherMoments);
    if (!key.length) return `${lead}\n\nNothing else on this file has timed speech to quote.`;
    const otherDay = key[0]?.workDate ? localStamp(key[0].workDate, catalog.timeZone) || 'another day' : 'another day';
    const lines = key.map((moment) => quoteBullet(moment, new Set(key.map((item) => item.proofId)).size > 1));
    return `${lead}\n\nOn ${otherDay}, ${who} said:\n\n${lines.join('\n')}`;
  }
  const known = clips
    .map((clip) => (clip.workDate ? localStamp(clip.workDate, catalog.timeZone) : ''))
    .filter(Boolean);
  const listed = known.length ? `Clips on file are from ${[...new Set(known)].join(' and ')}.` : fileContext(trace, catalog);
  return `Nothing on this file was recorded on ${label}.\n\n${listed}`;
}

/** Key lines a dated speech question may quote. Timed lines on that day win over other days. */
export function speechQuotesForQuestion(
  question: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
): AskMomentQuote[] | null {
  if (!/\b(say|said|quote|tell|mention)\b/i.test(question)) return null;
  const asked = parseAskDate(question);
  if (!asked) return null;
  const clips = spokenClips(trace);
  if (!clips.length) return null;
  const onDate = clips.filter((clip) => clipMatchesAskDate(clip.workDate, asked, catalog.timeZone));
  const others = clips.filter((clip) => !onDate.includes(clip));
  const timedOnDate = onDate.flatMap((clip) => clip.moments).filter((moment) => moment.atSeconds != null && moment.cite);
  const picked = timedOnDate.length
    ? selectSpeechMoments(timedOnDate)
    : [
        ...onDate.flatMap((clip) => clip.moments).filter((moment) => moment.atSeconds == null && moment.cite).slice(0, 1),
        ...selectSpeechMoments(
          others.flatMap((clip) => clip.moments).filter((moment) => moment.atSeconds != null && moment.cite),
        ),
      ];
  if (!picked.length) return null;
  return picked.map((moment) => ({
    sourceId: moment.cite!,
    speaker: moment.speaker,
    text: moment.excerpt,
    atSeconds: moment.atSeconds,
  }));
}

function composeQuestion(
  question: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
): string {
  const person = personBlock(trace);
  if (person?.offJob) return person.offJob;
  const dated = composeDatedSpeech(question, trace, catalog);
  if (dated) return dated;
  const hits = searchHits(trace).concat(speechFromClip(trace));
  const searched = trace.some((step) => step.tool === 'search_transcripts' || step.tool === 'get_clip');
  if (searched && !hits.length && (!person || /\b(say|said|quote|permit|lock)\b/i.test(question))) {
    return missingLine(question, trace, catalog);
  }
  if (hits.length && /\b(say|said|quote|tell|mention)\b/i.test(question)) {
    const hit = hits[0]!;
    const when = hit.atSeconds == null ? '' : `At ${clock(hit.atSeconds)}, `;
    return `${when}${hit.speaker} said “${hit.excerpt}”`;
  }
  const clips = clipsFromTrace(trace);
  const events = historyFromTrace(trace, catalog.timeZone);
  if (!clips.length && !events.length) return missingLine(question, trace, catalog);
  if (person && clips.length) {
    const count = `${clips.length} clip${clips.length === 1 ? '' : 's'}`;
    const lead = `**${person.name}** recorded ${count} on this file.${openedLine(events)}`;
    return [lead, clips.map((clip) => bullet(clip, catalog.timeZone)).join('\n')].join('\n\n');
  }
  if (clips.length) {
    const lead = `${clipCountLead(clips.length)}${openedLine(events)}`;
    return [lead, clips.map((clip) => bullet(clip, catalog.timeZone)).join('\n')].join('\n\n');
  }
  const first = events[0]!;
  const when = first.at ? ` on ${first.at}` : '';
  return `Job history shows ${first.summary.replace(/\.$/, '')}${when}.`;
}

function visitRows(clips: ClipFact[], timeZone?: string | null): string {
  const grouped = new Map<string, string[]>();
  for (const clip of clips) {
    const key = dateLabel(clip.workDate, timeZone);
    const notes = grouped.get(key) ?? [];
    notes.push(clip.summary || clip.title);
    grouped.set(key, notes);
  }
  const rows = [...grouped.entries()].map(([date, notes]) => `| ${date} | ${notes.join(' · ')} |`);
  return ['| Visit | What the file shows |', '| --- | --- |', ...rows].join('\n');
}

function composeTask(
  task: AskTaskKind,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
): string {
  const person = personBlock(trace);
  if (person?.offJob) return person.offJob;
  const clips = clipsFromTrace(trace);
  const events = historyFromTrace(trace, catalog.timeZone);
  const name = jobName(catalog);
  const lines = clips.map((clip) => bullet(clip, catalog.timeZone));
  const gap = 'Not on this file: a written scope, a punch list, or open issues.';

  if (task === 'compare') {
    const visits = catalogVisitFacts(catalog);
    const rows = visits.length >= clips.length ? visits : clips;
    if (rows.length < 2) {
      return `This file does not have two visits to compare. ${rows.length === 1 ? 'One clip is on file.' : 'No clips are on file.'}`;
    }
    const dates = [...new Set(rows.map((clip) => dateLabel(clip.workDate, catalog.timeZone)))];
    const lead =
      dates.length >= 2
        ? `**${dates[0]}** and **${dates[1]}** are different visits on this file.`
        : `These clips are on this file, and they are not separate dated visits.`;
    return `${lead}\n\n${artifact(`**Visit comparison — ${name}**\n\n${visitRows(rows, catalog.timeZone)}\n\n${gap}`)}`;
  }

  if (task === 'scope') {
    const body = clips.length
      ? lines.join('\n')
      : '- Nothing recorded is on this file yet.';
    return `This file has no written scope.\n\n${artifact(`**Scope note — ${name}**\n\nRecorded visits only:\n\n${body}\n\n${gap}`)}`;
  }

  if (task === 'issues' || task === 'punch') {
    const title = task === 'punch' ? 'Punch list' : 'Open issues';
    const lead = `Nothing on this file is logged as ${task === 'punch' ? 'a punch item' : 'an open issue'}.`;
    const observed = clips.length
      ? `Recorded visits, not logged as defects:\n\n${lines.join('\n')}`
      : 'No clips are on this file to review.';
    return `${lead}\n\n${artifact(`**${title} — ${name}**\n\nNo open items are written down.\n\n${observed}`)}`;
  }

  const who = person ? `**${person.name}** recorded ${clips.length} clip${clips.length === 1 ? '' : 's'} on this file.` : '';
  const lead = who || (clips.length ? clipCountLead(clips.length) : 'This file does not have clips to summarize.');
  const withOpen = `${lead}${openedLine(events)}`;
  if (!clips.length) return withOpen;
  const heading = task === 'summary' ? 'Homeowner summary' : 'Note';
  return `${withOpen}\n\n${artifact(`**${heading} — ${name}**\n\n${lines.join('\n')}\n\n${openedLine(events).trim()}\n\n${gap}`.replace(/\n{3,}/g, '\n\n'))}`;
}

export type ChatKind = 'greeting' | 'thanks' | 'opinion' | 'correction' | 'clarify' | 'restate' | 'recall';

type SpeechLine = { text: string; title: string; when: string; workDate: string | null; clipId: string };

function speechLines(catalog: AskLookupCatalog): SpeechLine[] {
  const lines: SpeechLine[] = [];
  for (const clip of catalogClips(catalog)) {
    const when = dateLabel(clip.workDate ?? null, catalog.timeZone);
    const title = cleanMentionTitle(clip.title) || 'Clip';
    for (const raw of clipAskPreview(clip).transcript.split('\n')) {
      const line = raw.trim();
      if (!line || /\[privacy redacted\]/i.test(line)) continue;
      const clock = line.match(/^\[(\d+:\d{2})\]\s*(.*)$/);
      const text = (clock ? clock[2] : line).replace(/^[^:]{1,40}:\s+/, '').trim();
      if (!text) continue;
      lines.push({ text, title, when, workDate: clip.workDate ?? null, clipId: clip.proofId });
    }
  }
  return lines;
}

function quoteSpoken(text: string): string {
  const clean = text.trim();
  return /[.!?]$/.test(clean) ? `“${clean}”` : `“${clean}.”`;
}

function quotedBits(text: string): string[] {
  return [...text.matchAll(/[“"]([^”"]{8,})[”"]/g)].map((match) => match[1]!.trim());
}

function lastAssistant(history: AskMemoryTurn[] | null | undefined): string {
  const turn = [...(history ?? [])].reverse().find((row) => row.role === 'assistant' && String(row.text ?? '').trim());
  return String(turn?.text ?? '');
}

function jobOffer(catalog: AskLookupCatalog): string {
  const name = jobName(catalog);
  const people = (catalog.people ?? []).filter((person) => person.onThisJob !== false && person.name).map((person) => person.name);
  const clips = catalogClips(catalog);
  const dates = [...new Set(clips.map((clip) => dateLabel(clip.workDate ?? null, catalog.timeZone)).filter((date) => date !== 'Undated'))];
  const client = String(catalog.clientName ?? '').trim().replace(/\.$/, '');
  const address = String(catalog.jobAddress ?? '').trim();
  const where = [client ? `client ${client}` : '', address].filter(Boolean).join(', ');
  const who = people.length ? people.join(', ') : 'No one is listed';
  const verb = people.length === 1 ? 'is' : 'are';
  const when = dates.length ? dates.join(' and ') : 'the clips on file';
  return `**${name}** is the open file${where ? ` (${where})` : ''}. ${who} ${verb} on clips from ${when}. I can quote a visit, compare the days, or summarize the job.`;
}

function splitSocial(question: string): { prefix: 'thanks' | 'greeting' | null; body: string } {
  const raw = question.trim();
  const thanks = raw.match(/^(?:thanks|thank you|thx|appreciate it|appreciated)[.!,\s]+([\s\S]+)$/i);
  if (thanks?.[1]?.trim()) return { prefix: 'thanks', body: thanks[1].trim() };
  const greet = raw.match(/^(?:hi|hey|hello|howdy|good\s+(?:morning|afternoon|evening))[.!,\s]+([\s\S]+)$/i);
  if (greet?.[1]?.trim() && greet[1].trim().length > 8) return { prefix: 'greeting', body: greet[1].trim() };
  return { prefix: null, body: raw };
}

function isGreeting(question: string): boolean {
  return /^(?:hi|hey|hello|howdy|yo|good\s+(?:morning|afternoon|evening)|how are you|how'?s it going|what'?s up)(?:\s+there)?[!.?\s]*$/i.test(
    question.trim(),
  );
}

function isThanks(question: string): boolean {
  return /^(?:thanks|thank you|thx|ty|appreciate(?:d| it)?)[!.\s]*$/i.test(question.trim());
}

function isOpinion(question: string, history: AskMemoryTurn[] | null | undefined): boolean {
  if (/\b(?:what do you think|why do you think|what(?:'s| is) your take|how come|do you think)\b/i.test(question)) return true;
  if (/^(?:why|how come)(?:\s+though)?[?.!\s]*$/i.test(question.trim()) && (history ?? []).some((turn) => String(turn.text ?? '').trim())) {
    return true;
  }
  return false;
}

function isRestateRequest(question: string): boolean {
  return /^(?:huh|what|what do you mean|can you clarify|come again|say that again)[?.!\s]*$/i.test(question.trim());
}

function isAmbiguousAsk(question: string, history: AskMemoryTurn[] | null | undefined, catalog: AskLookupCatalog): boolean {
  const q = question.trim();
  if (parseAskDate(q) || recentDate(history ?? [])) return false;
  const dates = [...new Set(catalogClips(catalog).map((clip) => clip.workDate).filter(Boolean))];
  if (dates.length < 2) return false;
  const bareSpeech = /^what did\s+(?:he|she|they|[\p{L}][\p{L} .'-]{0,40}?)\s+say\s*\??$/iu.test(q);
  const bareClip = /^(?:what about (?:the |that )?(?:clip|one|visit|video)|which (?:clip|one|visit)|tell me about (?:it|the clip|that))[?.!\s]*$/i.test(q);
  return bareSpeech || bareClip;
}

/** Greeting, thanks, opinion, correction, or a request that needs one clarifying question. */
export function classifyChatTurn(
  question: string,
  history: AskMemoryTurn[] | null | undefined,
  catalog: AskLookupCatalog,
): ChatKind | null {
  const q = question.trim();
  if (!q || isJobOverview(q)) return null;
  if (isLongMemoryQuestion(q)) return 'recall';
  if (isCorrection(q)) return 'correction';
  const { body, prefix } = splitSocial(q);
  if (isJobOverview(body)) return null;
  if (parseAskDate(body) && /\b(say|said|quote|tell|mention)\b/i.test(body)) return null;
  if (classifyAskIntent(body).kind === 'task' && !isOpinion(body, history)) return null;
  if (isOpinion(body, history)) return 'opinion';
  if (isRestateRequest(body)) return 'restate';
  if (isAmbiguousAsk(body, history, catalog)) return 'clarify';
  if (prefix === 'thanks' || isThanks(q)) return 'thanks';
  if (isGreeting(q)) return 'greeting';
  return null;
}

function focusLines(question: string, catalog: AskLookupCatalog, history: AskMemoryTurn[] | null | undefined): SpeechLine[] {
  const all = speechLines(catalog);
  const bits = quotedBits(lastAssistant(history));
  const counts = new Map<string, number>();
  for (const line of all) {
    const hit = bits.some((bit) => {
      const needle = bit.toLowerCase().slice(0, 24);
      return line.text.toLowerCase().includes(needle) || needle.includes(line.text.toLowerCase().slice(0, 24));
    });
    if (hit) counts.set(line.clipId, (counts.get(line.clipId) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  if (best) return all.filter((line) => line.clipId === best);
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
  const keywordHits = all.filter((line) => words.some((word) => line.text.toLowerCase().includes(word)));
  return keywordHits.length ? keywordHits : all.slice(0, 4);
}

function composeOpinion(question: string, catalog: AskLookupCatalog, history: AskMemoryTurn[] | null | undefined): string {
  const lines = focusLines(question, catalog, history).slice(0, 4);
  if (!lines.length) return `${jobOffer(catalog)} The transcripts do not give me more than that to go on.`;
  const when = lines[0]!.when;
  const spoken = lines.map((line) => `“${line.text}”`).join(', then ');
  const paperwork = lines.some((line) => /paper|spreadsheet|quickbooks/i.test(line.text));
  const read = paperwork
    ? 'He is talking about getting the work off paper and onto QuickBooks.'
    : 'I would not add a motive past those words.';
  return `On ${when}, the lines run ${spoken}. ${read}`;
}

function composeCorrection(question: string, catalog: AskLookupCatalog, history: AskMemoryTurn[] | null | undefined): string {
  const all = speechLines(catalog);
  const bits = quotedBits(lastAssistant(history));
  const matched = all.filter((line) =>
    bits.some((bit) => {
      const needle = bit.toLowerCase().slice(0, 20);
      return line.text.toLowerCase().includes(needle);
    }),
  );
  const clipDates = [...new Set(matched.map((line) => line.when))];
  const parts: string[] = [];
  const denied = question.match(/\b(?:never|didn'?t|did not)\s+(?:mention(?:ed)?|say|said)\s+(?:anything about\s+)?[“"]?([^”"?.!]+)/i);
  if (denied?.[1]) {
    const needle = denied[1].trim();
    const found = all.find((line) => line.text.toLowerCase().includes(needle.toLowerCase()));
    if (found) {
      parts.push(`The file does have that. On ${found.when}, in ${found.title}, the line is ${quoteSpoken(found.text)}`);
    } else {
      parts.push(`I do not see “${needle}” in the transcripts.`);
    }
  }
  const userDate = parseAskDate(question);
  if (userDate && clipDates.length) {
    const onUserDay = matched.some((line) => clipMatchesAskDate(line.workDate, userDate, catalog.timeZone));
    if (!onUserDay) {
      const label = formatAskDate(userDate);
      const elsewhere = all.find((line) => clipMatchesAskDate(line.workDate, userDate, catalog.timeZone));
      const other = elsewhere ? ` ${elsewhere.when} only has ${quoteSpoken(elsewhere.text)}` : '';
      parts.push(`Those lines are from ${clipDates.join(' and ')}, not ${label}.${other}`);
    }
  }
  if (parts.length) return parts.join(' ');
  const fact = bits[0] ? `“${bits[0]}”` : jobOffer(catalog);
  return `Here is what the file still supports: ${fact}. Which part of that is off?`;
}

function composeClarify(catalog: AskLookupCatalog): string {
  const clips = catalogClips(catalog);
  const dates = [...new Set(clips.map((clip) => dateLabel(clip.workDate ?? null, catalog.timeZone)).filter((date) => date !== 'Undated'))];
  if (dates.length >= 2) return `Which day do you mean? On file: ${dates.join(' and ')}.`;
  const list = clips
    .slice(0, 4)
    .map((clip) => `${dateLabel(clip.workDate ?? null, catalog.timeZone)} — ${cleanMentionTitle(clip.title) || 'Clip'}`)
    .join('; ');
  return list ? `Which clip do you mean? On file: ${list}.` : 'Which clip do you mean? Nothing is on this file yet.';
}

function composeRestate(catalog: AskLookupCatalog, history: AskMemoryTurn[] | null | undefined): string {
  const last = lastAssistant(history).replace(/⟦[\s\S]*$/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!last) return jobOffer(catalog);
  const sentence = last.split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
  return `${sentence} I can quote a single visit or compare the days if you want it narrower.`;
}

function composeThanks(catalog: AskLookupCatalog, history: AskMemoryTurn[] | null | undefined): string {
  const when = recentDate(history ?? []);
  const stay = when
    ? `I can stay on ${formatAskDate(when)}, pull another day, or compare the visits on ${jobName(catalog)}.`
    : jobOffer(catalog);
  return `Glad that helped. ${stay}`;
}

function composeChat(
  kind: ChatKind,
  question: string,
  catalog: AskLookupCatalog,
  history: AskMemoryTurn[] | null | undefined,
): string {
  switch (kind) {
    case 'greeting':
      return `Hi. ${jobOffer(catalog)}`;
    case 'thanks':
      return composeThanks(catalog, history);
    case 'opinion':
      return composeOpinion(question, catalog, history);
    case 'correction':
      return composeCorrection(question, catalog, history);
    case 'clarify':
      return composeClarify(catalog);
    case 'restate':
      return composeRestate(catalog, history);
    case 'recall':
      return jobOffer(catalog);
    default:
      return jobOffer(catalog);
  }
}

/** Grounded reply when the model is absent. Never invents a fact the tools did not return. */
export function composeGroundedAsk(
  question: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
  history?: AskMemoryTurn[] | null,
  memory?: LongThreadMemory | null,
): string {
  const chat = classifyChatTurn(question, history, catalog);
  if (chat === 'recall') {
    return polishAskProse(recallLongMemory(question, memory, { timeZone: catalog.timeZone }), {
      timeZone: catalog.timeZone,
      jobTitle: catalog.jobTitle,
    });
  }
  if (chat) {
    return polishAskProse(composeChat(chat, question, catalog, history), { timeZone: catalog.timeZone, jobTitle: catalog.jobTitle });
  }
  if (isJobOverview(question)) {
    return polishAskProse(composeJobOverview(catalog), { timeZone: catalog.timeZone, jobTitle: catalog.jobTitle });
  }
  const intent = classifyAskIntent(question);
  const text = intent.kind === 'task' ? composeTask(intent.task, trace, catalog) : composeQuestion(question, trace, catalog);
  const polished = polishAskProse(text, { timeZone: catalog.timeZone, jobTitle: catalog.jobTitle });
  if (/^this file does not have that\.?$/i.test(polished)) {
    return polishAskProse(
      `${polished}\n\n${fileContext(trace, catalog)}`,
      { timeZone: catalog.timeZone, jobTitle: catalog.jobTitle },
    );
  }
  return polished;
}
