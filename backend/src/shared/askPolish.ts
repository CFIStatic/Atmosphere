/**
 * Turn lookup results into a project-manager answer.
 *
 * The first sentence is the result. A request to produce something
 * (summary, scope note, comparison, issues, punch list) becomes a finished
 * note the chat can copy. Visible prose never carries ids, UTC, or filler.
 */
import { cleanMentionTitle, prettyMentionStamp } from './mentions.js';
import type { AskLookupCatalog, AskLookupTraceStep } from './askLookup.js';

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

function missingLine(question: string): string {
  if (/\bpermit\b/i.test(question)) return 'This file does not include a permit number.';
  if (/\block\s?box\b|\bcode\b/i.test(question)) return 'This file does not include that code.';
  return 'This file does not have that.';
}

function composeQuestion(
  question: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
): string {
  const person = personBlock(trace);
  if (person?.offJob) return person.offJob;
  const hits = searchHits(trace).concat(speechFromClip(trace));
  const searched = trace.some((step) => step.tool === 'search_transcripts' || step.tool === 'get_clip');
  if (searched && !hits.length && (!person || /\b(say|said|quote|permit|lock)\b/i.test(question))) {
    return missingLine(question);
  }
  if (hits.length && /\b(say|said|quote|tell|mention)\b/i.test(question)) {
    const hit = hits[0]!;
    const when = hit.atSeconds == null ? '' : `At ${clock(hit.atSeconds)}, `;
    return `${when}${hit.speaker} said “${hit.excerpt}”`;
  }
  const clips = clipsFromTrace(trace);
  const events = historyFromTrace(trace, catalog.timeZone);
  if (!clips.length && !events.length) return missingLine(question);
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
  const intent = classifyAskIntent(question);
  const text = intent.kind === 'task' ? composeTask(intent.task, trace, catalog) : composeQuestion(question, trace, catalog);
  return polishAskProse(text, { timeZone: catalog.timeZone, jobTitle: catalog.jobTitle });
}
