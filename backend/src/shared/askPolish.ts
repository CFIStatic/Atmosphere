/**
 * Turn lookup results into a project-manager answer.
 *
 * The first sentence is the result. A request to produce something
 * (summary, scope note, comparison, issues, punch list) becomes a finished
 * note the chat can copy. Visible prose never carries ids, UTC, or filler.
 */
import { cleanMentionTitle, prettyMentionStamp } from './mentions.js';
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
    const summary = String(clip.summary ?? '').trim();
    const speech = clearestLine(clipAskPreview(clip).transcript);
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

function recentDate(turns: AskMemoryTurn[]) {
  for (const turn of [...turns].reverse()) {
    const parsed = parseAskDate(String(turn.text ?? ''));
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Rewrite a short follow-up so pronouns, "and on Sep 21?", and "the first visit"
 * point at the person, date, and clips from earlier in the thread.
 */
export function resolveAskQuestion(
  question: string,
  history: AskMemoryTurn[] | null | undefined,
  catalog: AskLookupCatalog,
): string {
  const turns = (history ?? []).filter((turn) => String(turn.text ?? '').trim()).slice(-8);
  if (!turns.length) return question;
  const q = question.trim();
  const person = recentPerson(turns, catalog);
  const namedHere = (catalog.people ?? []).some((row) => row.name && q.toLowerCase().includes(row.name.toLowerCase()));
  const asked = parseAskDate(q);
  const prevDate = recentDate(turns);
  const prevUser = [...turns].reverse().find((turn) => turn.role !== 'assistant');
  const prevSpeech = /\b(say|said|quote|tell|mention)\b/i.test(String(prevUser?.text ?? ''));

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
    if (clips.length < 2) {
      return `This file does not have two visits to compare. ${clips.length === 1 ? 'One clip is on file.' : 'No clips are on file.'}`;
    }
    const dates = [...new Set(clips.map((clip) => dateLabel(clip.workDate, catalog.timeZone)))];
    const lead =
      dates.length >= 2
        ? `**${dates[0]}** and **${dates[1]}** are different visits on this file.`
        : `These clips are on this file, and they are not separate dated visits.`;
    return `${lead}\n\n${artifact(`**Visit comparison — ${name}**\n\n${visitRows(clips, catalog.timeZone)}\n\n${gap}`)}`;
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

/** Grounded reply when the model is absent. Never invents a fact the tools did not return. */
export function composeGroundedAsk(
  question: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
): string {
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
