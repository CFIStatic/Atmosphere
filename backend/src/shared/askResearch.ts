/**
 * Multi-step research for Ask.
 *
 * Simple questions stay on the single pass in answerFromAskLookup / answerFromClip.
 * Harder questions (comparisons, timelines, everything-about, cross-clip or
 * cross-job, repeated counts, multi-part) plan a step, run the existing
 * retrieval tools in parallel, drop duplicates into a scratchpad, then check
 * which parts of the question are still open. The loop stops when the
 * question is covered, after ASK_RESEARCH_MAX_STEPS, or at
 * ASK_RESEARCH_BUDGET_MS. One synthesis call then reads only that scratchpad.
 *
 * A loop error, a model failure, or an empty synthesis throws. Callers fall
 * back to the single pass. This module does not stream tokens or status text.
 */
import type { MeasuredUsage } from '../lib/anthropic.js';
import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { logger } from '../lib/logger.js';
import type { ClipAskRecord } from './clipAsk.js';
import { composeGroundedAsk } from './askPolish.js';
import type { LongThreadMemory } from './askMemory.js';
import {
  asksAboutOtherJobs,
  clipsInScope,
  executeAskLookup,
  type AskLookupCatalog,
  type AskLookupClip,
  type AskLookupTraceStep,
} from './askLookup.js';
import { formatAskClock, formatAskDate } from './askMoments.js';
import { speakerLabelOrUnidentified, UNIDENTIFIED_SPEAKER, UNIDENTIFIED_SPEAKER_PROSE } from './askSpeakers.js';
import { chunkClipTranscript, retrieveAskEvidence, searchPhrases, type TranscriptChunk } from './askTranscriptIndex.js';
import {
  isAskWebSearchConfigured,
  looksLikeExplicitWebSearchRequest,
  searchAskWebDetailed,
  shouldSupplementWithWebSearch,
} from './askWebSearch.js';

/** Hard-question research stops after this many plan / retrieve / check cycles. */
export const ASK_RESEARCH_MAX_STEPS = 4;
/** Wall-clock budget for the research steps. Synthesis runs after this. */
export const ASK_RESEARCH_BUDGET_MS = 20_000;

export type AskResearchStop = 'sufficient' | 'max_steps' | 'budget' | 'fallback';

export type AskResearchStep = {
  step: number;
  /** Sub-queries for this step. Debugging metadata only — not logged. */
  queries: string[];
  tools: string[];
  added: number;
  total: number;
  ms: number;
  covered: string[];
  gaps: string[];
};

export type AskResearchTrace = {
  route: 'research';
  stopReason: AskResearchStop;
  steps: AskResearchStep[];
  elapsedMs: number;
};

export type ResearchRecordKind = 'chunk' | 'clip' | 'hit' | 'field' | 'history' | 'web' | 'mention';

export type ResearchRecord = {
  id: string;
  kind: ResearchRecordKind;
  proofId: string | null;
  jobId: string | null;
  clipTitle: string | null;
  startSec: number | null;
  speaker: string | null;
  text: string;
  cite: string | null;
};

export type ResearchScratchpad = {
  records: ResearchRecord[];
  ids: Set<string>;
};

export type ResearchCall = { name: string; input: Record<string, unknown> };

export type ResearchModelKind = 'plan' | 'sufficiency' | 'synthesis';

export type ResearchComplete = (input: {
  kind: ResearchModelKind;
  system: string;
  stable: string;
  user: string;
}) => Promise<{ text: string; model?: string | null; usage?: MeasuredUsage | null } | null>;

const PLAN_SYSTEM = `You plan the next retrieval step for a job-file question. Reply with JSON only: {"calls":[{"tool":"search_transcripts","query":"..."}]}
Tools: search_transcripts (query), get_clip (proofId), read_job_history, read_job_fields, list_clips, list_person_activity (name), search_other_jobs (query), web_search (query).
Use only proof ids from the clip index. search_other_jobs only when the question is about other jobs. web_search only when the question explicitly asks to search the web. Do not write the answer.`;

const SUFFICIENCY_SYSTEM = `You check whether retrieved evidence answers the question. Reply with JSON only: {"sufficient":true,"covered":["part"],"gaps":["part still open"]}
sufficient is true only when every part of the question is answered or the evidence shows that part is not on file. Do not write the answer. Do not quote transcript lines.`;

const SYNTHESIS_SYSTEM = `You answer from the evidence block only. The job file wins: web notes never override a job clip, field, or note.
The first sentence is the answer. Say what is on file and, in the same reply, what is not. Never reply with only "this file does not have that."
Quote speech only as an exact substring of a transcript chunk in the evidence, in “ ”, with the clip name and time, like “We need the permit.” (Kitchen walkthrough, 0:15).
Speakers are diarization labels ("Speaker 1") or a name the evidence explicitly attaches. Otherwise write "an unidentified speaker". Never infer a name, role, or posture.
No hidden markers, no ⟦tags⟧, no raw ids. Clean markdown. A table when comparing visits.`;

export function routeAskResearch(question: string): { route: 'single' | 'research'; reason: string } {
  const q = question.trim();
  if (!q) return { route: 'single', reason: 'empty' };
  if (/\b(what(?:'s| has| have)? changed|what changed|between the first|between the last|first and last visit|timeline|over time)\b/i.test(q)) {
    return { route: 'research', reason: 'timeline' };
  }
  if (/\b(compare|versus|vs\.?|difference between)\b/i.test(q) || asksAboutOtherJobs(q) || /\bsimilar job\b/i.test(q)) {
    return { route: 'research', reason: 'comparison' };
  }
  if (/\b(everything about|all about|tell me everything|every time|each time|how many times|list every)\b/i.test(q)) {
    return { route: 'research', reason: 'enumeration' };
  }
  if (/\b(across (?:the )?(?:clips|visits|jobs)|cross[- ]clip|cross[- ]job|every clip|each clip|each visit|every visit)\b/i.test(q)) {
    return { route: 'research', reason: 'cross_scope' };
  }
  if ((q.match(/\?/g) ?? []).length >= 2) return { route: 'research', reason: 'multi_part' };
  return { route: 'single', reason: 'simple' };
}

export function createResearchScratchpad(): ResearchScratchpad {
  return { records: [], ids: new Set() };
}

/** Insert records the scratchpad has not already kept. Identity is the chunk or record id. */
export function addResearchRecords(pad: ResearchScratchpad, records: ResearchRecord[]): number {
  let added = 0;
  for (const record of records) {
    const id = record.id.trim();
    if (!id || pad.ids.has(id) || !record.text.trim()) continue;
    pad.ids.add(id);
    pad.records.push({ ...record, id });
    added += 1;
  }
  return added;
}

export function catalogFromClipRecord(
  record: ClipAskRecord,
  scope?: { orgId?: string; jobId?: string; proofId?: string; title?: string | null },
): AskLookupCatalog {
  const proofId = scope?.proofId || 'clip';
  const jobId = scope?.jobId || 'job';
  const orgId = scope?.orgId || 'org';
  const clip: AskLookupClip = {
    proofId,
    jobId,
    orgId,
    title: (scope?.title || record.company || 'This clip').trim() || 'This clip',
    workDate: record.workDate ?? null,
    summary: record.summary ?? record.conversationSummary ?? null,
    transcript: record.transcript ?? null,
    privacyRedactions: record.privacyRedactions,
    childPrivacyRedactions: record.childPrivacyRedactions,
  };
  return {
    orgId,
    jobId,
    access: 'org',
    jobTitle: scope?.title ?? null,
    timeZone: 'America/Chicago',
    clips: [clip],
    people: [],
    history: [],
  };
}

function clipById(catalog: AskLookupCatalog, proofId: string): AskLookupClip | null {
  const id = proofId.trim();
  if (!id) return null;
  return (
    clipsInScope(catalog).find((clip) => clip.proofId === id) ??
    (catalog.orgClips ?? []).find((clip) => clip.proofId === id && clip.orgId === catalog.orgId) ??
    null
  );
}

function datedClips(catalog: AskLookupCatalog): AskLookupClip[] {
  return clipsInScope(catalog)
    .slice()
    .sort((a, b) => {
      const byDate = String(a.workDate ?? '').localeCompare(String(b.workDate ?? ''));
      if (byDate) return byDate;
      return String(a.capturedAt ?? '').localeCompare(String(b.capturedAt ?? '')) || a.title.localeCompare(b.title);
    });
}

function topicTerms(question: string): string[] {
  const found = searchPhrases(question);
  const words = [...found.phrases.flatMap((phrase) => phrase.toLowerCase().split(/\s+/)), ...found.terms.map((term) => term.toLowerCase())];
  return [...new Set(words.filter((word) => word.length > 3))];
}

const QUERY_FRAME = new Set([
  'compare',
  'versus',
  'difference',
  'between',
  'changed',
  'change',
  'across',
  'every',
  'list',
  'about',
  'visit',
  'visits',
  'other',
  'others',
  'jobs',
  'job',
  'seen',
  'have',
  'last',
  'this',
  'file',
  'files',
  'clip',
  'clips',
]);

function contentQuery(question: string): string {
  const singles = topicTerms(question).filter((term) => !term.includes(' ') && !QUERY_FRAME.has(term));
  singles.sort((a, b) => b.length - a.length);
  return singles[0] ?? '';
}

function isTimelineQuestion(question: string): boolean {
  return routeAskResearch(question).reason === 'timeline';
}

function isCrossJobQuestion(question: string): boolean {
  return asksAboutOtherJobs(question) || /\bsimilar job\b|\blast job\b|\bother jobs?\b/i.test(question);
}

function isEnumerationQuestion(question: string): boolean {
  return /\b(everything about|all about|tell me everything|every time|each time|how many times|list every)\b/i.test(question);
}

function callKey(call: ResearchCall): string {
  return `${call.name}:${JSON.stringify(call.input)}`;
}

function queryOf(call: ResearchCall): string {
  const query = call.input.query ?? call.input.name ?? call.input.proofId ?? '';
  return String(query || call.name).slice(0, 160);
}

function openedProofs(pad: ResearchScratchpad): Set<string> {
  const ids = new Set<string>();
  for (const record of pad.records) {
    if ((record.kind === 'chunk' || record.kind === 'clip') && record.proofId) ids.add(record.proofId);
  }
  return ids;
}

function heuristicCalls(question: string, catalog: AskLookupCatalog, pad: ResearchScratchpad, ran: Set<string>): ResearchCall[] {
  const calls: ResearchCall[] = [];
  const push = (call: ResearchCall) => {
    const key = callKey(call);
    if (ran.has(key) || calls.some((existing) => callKey(existing) === key)) return;
    calls.push(call);
  };
  push({ name: 'list_clips', input: {} });
  push({ name: 'read_job_fields', input: {} });

  const person = (catalog.people ?? []).find((row) => row.name && question.toLowerCase().includes(row.name.toLowerCase()));
  if (person) push({ name: 'list_person_activity', input: { name: person.name } });

  if (isTimelineQuestion(question)) {
    const clips = datedClips(catalog);
    const first = clips[0];
    const last = clips[clips.length - 1];
    const opened = openedProofs(pad);
    if (first && !opened.has(first.proofId)) push({ name: 'get_clip', input: { proofId: first.proofId } });
    if (last && last.proofId !== first?.proofId && !opened.has(last.proofId)) {
      push({ name: 'get_clip', input: { proofId: last.proofId } });
    }
  }

  if (isEnumerationQuestion(question) || routeAskResearch(question).reason === 'multi_part') {
    const parts = question.split('?').map((part) => part.trim()).filter((part) => part.length > 8);
    const queries = (parts.length >= 2 ? parts : [question]).map(contentQuery).filter(Boolean);
    for (const query of queries) push({ name: 'search_transcripts', input: { query } });
    const opened = openedProofs(pad);
    const terms = topicTerms(question);
    for (const clip of clipsInScope(catalog)) {
      if (opened.has(clip.proofId) || calls.filter((call) => call.name === 'get_clip').length >= 4) continue;
      const hay = `${clip.title}\n${clip.transcript ?? ''}`.toLowerCase();
      if (terms.some((term) => hay.includes(term))) push({ name: 'get_clip', input: { proofId: clip.proofId } });
    }
  }

  if (isCrossJobQuestion(question) && catalog.access !== 'viewer') {
    const query = contentQuery(question) || 'similar';
    push({ name: 'search_other_jobs', input: { query } });
    push({ name: 'search_transcripts', input: { query } });
    const opened = openedProofs(pad);
    for (const clip of clipsInScope(catalog).slice(0, 3)) {
      if (!opened.has(clip.proofId)) push({ name: 'get_clip', input: { proofId: clip.proofId } });
    }
    for (const record of pad.records) {
      if (record.kind !== 'hit' || !record.proofId || opened.has(record.proofId)) continue;
      if (calls.filter((call) => call.name === 'get_clip').length >= 4) break;
      push({ name: 'get_clip', input: { proofId: record.proofId } });
    }
  }

  if (looksLikeExplicitWebSearchRequest(question) && isAskWebSearchConfigured() && shouldSupplementWithWebSearch(question)) {
    push({ name: 'web_search', input: { query: question } });
  }

  return calls.slice(0, 8);
}

function facetReport(question: string, catalog: AskLookupCatalog, pad: ResearchScratchpad, ran: Set<string>): {
  sufficient: boolean;
  covered: string[];
  gaps: string[];
} {
  const covered: string[] = [];
  const gaps: string[] = [];
  const opened = openedProofs(pad);
  if (ran.has(callKey({ name: 'read_job_fields', input: {} }))) covered.push('job fields');
  if (ran.has(callKey({ name: 'list_clips', input: {} }))) covered.push('clip list');
  if (isTimelineQuestion(question)) {
    const clips = datedClips(catalog);
    const first = clips[0];
    const last = clips[clips.length - 1];
    if (!first || opened.has(first.proofId)) covered.push('first visit');
    else gaps.push('first visit');
    if (!last || last.proofId === first?.proofId || opened.has(last.proofId)) covered.push('last visit');
    else gaps.push('last visit');
  }
  if (isEnumerationQuestion(question)) {
    const terms = topicTerms(question);
    const hay = pad.records.filter((record) => record.kind === 'chunk').map((record) => record.text.toLowerCase()).join('\n');
    if (!terms.length || terms.some((term) => hay.includes(term)) || ran.has(callKey({ name: 'search_transcripts', input: { query: contentQuery(question) } }))) {
      covered.push('mentions');
    } else gaps.push('mentions');
  }
  if (isCrossJobQuestion(question)) {
    const searched = [...ran].some((key) => key.startsWith('search_other_jobs:'));
    if (!searched && catalog.access !== 'viewer') gaps.push('other jobs');
    else covered.push('other jobs');
    const pending = pad.records.some((record) => record.kind === 'hit' && record.proofId && !opened.has(record.proofId));
    if (pending) gaps.push('other job clips');
    else if (searched) covered.push('other job clips');
  }
  const more = heuristicCalls(question, catalog, pad, ran);
  return { sufficient: gaps.length === 0 && more.length === 0, covered, gaps };
}

function scopeStable(catalog: AskLookupCatalog): string {
  const clips = [...clipsInScope(catalog), ...(catalog.access === 'viewer' ? [] : catalog.orgClips ?? [])];
  const lines = [
    `Job: ${catalog.jobTitle ?? ''} (${catalog.jobId ?? 'org'})`,
    ...clips.slice(0, 40).map((clip) => `${clip.proofId} | ${clip.title} | ${clip.workDate ?? ''} | ${clip.jobId}`),
  ];
  return lines.join('\n').slice(0, 6000);
}

function chunkRecord(chunk: Pick<TranscriptChunk, 'key' | 'proofId' | 'jobId' | 'clipTitle' | 'startSec' | 'speaker' | 'text' | 'cite'>): ResearchRecord {
  return {
    id: chunk.key,
    kind: 'chunk',
    proofId: chunk.proofId,
    jobId: chunk.jobId,
    clipTitle: chunk.clipTitle,
    startSec: chunk.startSec,
    speaker: chunk.speaker,
    text: chunk.text,
    cite: chunk.cite,
  };
}

function fieldRecords(catalog: AskLookupCatalog): ResearchRecord[] {
  const rows: ResearchRecord[] = [];
  const push = (name: string, value: string | null | undefined) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    rows.push({
      id: `field:${name}`,
      kind: 'field',
      proofId: null,
      jobId: catalog.jobId,
      clipTitle: null,
      startSec: null,
      speaker: null,
      text: `${name}: ${text}`,
      cite: null,
    });
  };
  push('title', catalog.jobTitle);
  push('address', catalog.jobAddress);
  push('client', catalog.clientName);
  push('description', catalog.jobDescription);
  for (const event of catalog.history ?? []) {
    const text = String(event.summary ?? '').trim();
    if (!text) continue;
    rows.push({
      id: `history:${event.id}`,
      kind: 'history',
      proofId: null,
      jobId: event.jobId,
      clipTitle: null,
      startSec: null,
      speaker: null,
      text,
      cite: null,
    });
  }
  return rows;
}

function listClipRecords(catalog: AskLookupCatalog): ResearchRecord[] {
  return clipsInScope(catalog).map((clip) => ({
    id: `clip-list:${clip.proofId}`,
    kind: 'clip' as const,
    proofId: null,
    jobId: clip.jobId,
    clipTitle: clip.title,
    startSec: null,
    speaker: null,
    text: `${clip.title} | ${clip.workDate ?? 'undated'} | ${clip.transcript ? 'transcribed' : clip.summary ? 'summarized' : 'pending'}`,
    cite: null,
  }));
}

async function runCall(
  call: ResearchCall,
  catalog: AskLookupCatalog,
  question: string,
  fetchFn?: typeof fetch,
): Promise<{ step: AskLookupTraceStep; records: ResearchRecord[] }> {
  if (call.name === 'read_job_fields') {
    const records = fieldRecords(catalog);
    return {
      step: {
        tool: call.name,
        input: call.input,
        result: { ok: true, tool: call.name, summary: `${records.length} job field(s) or note(s).`, data: { count: records.length } },
      },
      records,
    };
  }
  if (call.name === 'list_clips') {
    const records = listClipRecords(catalog);
    return {
      step: {
        tool: call.name,
        input: call.input,
        result: { ok: true, tool: call.name, summary: `${records.length} clip(s) in scope.`, data: { count: records.length } },
      },
      records,
    };
  }
  if (call.name === 'web_search') {
    const allowed = looksLikeExplicitWebSearchRequest(question) && shouldSupplementWithWebSearch(question);
    if (!allowed || !isAskWebSearchConfigured()) {
      return {
        step: { tool: call.name, input: call.input, result: { ok: false, tool: call.name, summary: 'Web search stays off for this question.' } },
        records: [],
      };
    }
    const query = String(call.input.query ?? question);
    const outcome = await searchAskWebDetailed(query, { fetchFn, limit: 5, timeZone: catalog.timeZone || 'America/Chicago' });
    const records: ResearchRecord[] = outcome.hits.map((hit) => ({
      id: `web:${hit.url}`,
      kind: 'web',
      proofId: null,
      jobId: null,
      clipTitle: null,
      startSec: null,
      speaker: null,
      text: `${hit.title} ${hit.snippet}`.trim(),
      cite: hit.url,
    }));
    return {
      step: {
        tool: call.name,
        input: { query },
        result: { ok: true, tool: call.name, summary: outcome.answer || `${records.length} web result(s).`, data: { count: records.length } },
      },
      records,
    };
  }
  if (call.name === 'search_transcripts') {
    const query = String(call.input.query ?? '');
    const evidence = retrieveAskEvidence(catalog, query, { useDate: false, limit: 8 });
    const result = executeAskLookup(call.name, call.input, catalog);
    return { step: { tool: call.name, input: call.input, result }, records: evidence.transcript.map(chunkRecord) };
  }
  if (call.name === 'get_clip') {
    const proofId = String(call.input.proofId ?? '');
    const result = executeAskLookup(call.name, call.input, catalog);
    const clip = clipById(catalog, proofId);
    const records: ResearchRecord[] = [];
    if (clip) {
      records.push({
        id: `clip:${clip.proofId}`,
        kind: 'clip',
        proofId: clip.proofId,
        jobId: clip.jobId,
        clipTitle: clip.title,
        startSec: null,
        speaker: null,
        text: `${clip.title} | ${clip.workDate ?? 'undated'} | ${clip.transcript ? 'transcribed' : 'pending'}`,
        cite: null,
      });
      records.push(...chunkClipTranscript(clip).map(chunkRecord));
    }
    return { step: { tool: call.name, input: call.input, result }, records };
  }
  if (call.name === 'search_other_jobs') {
    const result = executeAskLookup(call.name, call.input, catalog);
    const hits = Array.isArray((result.data as { hits?: unknown } | undefined)?.hits)
      ? ((result.data as { hits: Array<Record<string, unknown>> }).hits ?? [])
      : [];
    const records: ResearchRecord[] = hits.map((hit, index) => ({
      id: `hit:${String(hit.proofId ?? index)}:${index}`,
      kind: 'hit',
      proofId: hit.proofId ? String(hit.proofId) : null,
      jobId: hit.jobId ? String(hit.jobId) : null,
      clipTitle: hit.title ? String(hit.title) : null,
      startSec: hit.atSeconds == null ? null : Number(hit.atSeconds),
      speaker: hit.speaker ? String(hit.speaker) : null,
      text: String(hit.excerpt ?? hit.title ?? ''),
      cite: hit.cite ? String(hit.cite) : null,
    }));
    return { step: { tool: call.name, input: call.input, result }, records };
  }
  const result = executeAskLookup(call.name, call.input, catalog);
  const records: ResearchRecord[] = [];
  if (call.name === 'list_person_activity') {
    records.push({
      id: `mention:${String(call.input.name ?? 'person')}`,
      kind: 'mention',
      proofId: null,
      jobId: catalog.jobId,
      clipTitle: null,
      startSec: null,
      speaker: null,
      text: result.summary,
      cite: null,
    });
  }
  if (call.name === 'read_job_history') {
    records.push(...fieldRecords(catalog).filter((record) => record.kind === 'history'));
  }
  return { step: { tool: call.name, input: call.input, result }, records };
}

function parseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const TOOLS = new Set([
  'search_transcripts',
  'get_clip',
  'read_job_history',
  'read_job_fields',
  'list_clips',
  'list_person_activity',
  'search_other_jobs',
  'web_search',
]);

function callsFromModel(parsed: Record<string, unknown>, question: string, catalog: AskLookupCatalog): ResearchCall[] {
  const raw = Array.isArray(parsed.calls) ? parsed.calls : [];
  const calls: ResearchCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = String(row.tool ?? row.name ?? '');
    if (!TOOLS.has(name)) continue;
    if (name === 'search_other_jobs' && (catalog.access === 'viewer' || !isCrossJobQuestion(question))) continue;
    if (name === 'web_search' && !(looksLikeExplicitWebSearchRequest(question) && shouldSupplementWithWebSearch(question))) continue;
    const input: Record<string, unknown> = {};
    if (row.query) input.query = String(row.query).slice(0, 240);
    if (row.proofId) input.proofId = String(row.proofId);
    if (row.name && name === 'list_person_activity') input.name = String(row.name);
    calls.push({ name, input });
    if (calls.length >= 6) break;
  }
  return calls;
}

function evidenceForModel(pad: ResearchScratchpad): string {
  return pad.records
    .slice(0, 24)
    .map((record) => {
      const when = record.startSec == null ? '' : ` ${formatAskClock(record.startSec)}`;
      const who = record.speaker ? ` ${speakerLabelOrUnidentified(record.speaker)}` : '';
      const title = record.clipTitle ? `${record.clipTitle}` : record.kind;
      return `[${record.kind}] ${title}${when}${who}: ${record.text}`;
    })
    .join('\n');
}

function dayLabel(workDate: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate ?? ''));
  if (!match) return 'Undated';
  return formatAskDate({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
}

function quoteBit(record: ResearchRecord): string {
  const who = speakerLabelOrUnidentified(record.speaker);
  const speaker = who === UNIDENTIFIED_SPEAKER ? UNIDENTIFIED_SPEAKER_PROSE : who;
  const when = record.startSec == null ? '' : `, ${formatAskClock(record.startSec)}`;
  const title = record.clipTitle || 'Clip';
  return `${speaker} said “${record.text.trim()}” (${title}${when})`;
}

function jobChunks(pad: ResearchScratchpad, catalog: AskLookupCatalog, which: 'this' | 'other'): ResearchRecord[] {
  return pad.records.filter((record) => {
    if (record.kind !== 'chunk' || !record.text.trim()) return false;
    const here = !record.jobId || record.jobId === catalog.jobId;
    return which === 'this' ? here : !here;
  });
}

function composeTimeline(question: string, catalog: AskLookupCatalog, pad: ResearchScratchpad): string | null {
  if (!isTimelineQuestion(question)) return null;
  const clips = datedClips(catalog);
  const first = clips[0];
  const last = clips.length > 1 ? clips[clips.length - 1] : null;
  const linesFor = (clip: AskLookupClip | undefined) =>
    clip ? jobChunks(pad, catalog, 'this').filter((record) => record.proofId === clip.proofId).slice(0, 3) : [];
  const firstLines = linesFor(first);
  const lastLines = linesFor(last ?? undefined);
  if (!first) return `This job has no clips yet, so there is no first or last visit to compare. Notes and job fields are the rest of the file.`;
  if (!last || last.proofId === first.proofId) {
    const said = firstLines.length ? firstLines.map(quoteBit).join(' ') : 'No transcript lines are on that clip.';
    return `Only one dated visit is on file (${dayLabel(first.workDate)}, ${first.title}). ${said} A later visit is not on file.`;
  }
  const pick = (rows: ResearchRecord[]) => {
    const budget = rows.filter((row) => /budget|thousand|dollar/i.test(row.text));
    const rest = rows.filter((row) => !budget.includes(row));
    return [...budget, ...rest].slice(0, 3);
  };
  const early = pick(firstLines);
  const late = pick(lastLines);
  const earlyText = early.length ? early.map(quoteBit).join(' ') : 'No transcript lines are on that clip.';
  const lateText = late.length ? late.map(quoteBit).join(' ') : 'No transcript lines are on that clip.';
  return [
    `What was said changed between the first visit and the last visit.`,
    `On the first visit (${dayLabel(first.workDate)}, ${first.title}), ${earlyText}`,
    `On the last visit (${dayLabel(last.workDate)}, ${last.title}), ${lateText}`,
    `There is no written change log on this file. The difference is in those lines.`,
  ].join('\n\n');
}

function sharedTerm(left: ResearchRecord[], right: ResearchRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const record of left) {
    for (const word of record.text.toLowerCase().match(/[a-z]{5,}/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const rightWords = new Set(right.flatMap((record) => record.text.toLowerCase().match(/[a-z]{5,}/g) ?? []));
  const shared = [...counts.keys()].filter((word) => rightWords.has(word) && !['there', 'their', 'about', 'would', 'could'].includes(word));
  shared.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || b.length - a.length);
  return shared[0] ?? null;
}

function composeCrossJob(question: string, catalog: AskLookupCatalog, pad: ResearchScratchpad): string | null {
  if (!isCrossJobQuestion(question)) return null;
  const here = jobChunks(pad, catalog, 'this');
  const elsewhere = jobChunks(pad, catalog, 'other');
  const title = catalog.jobTitle || 'This job';
  if (!elsewhere.length) {
    const local = here.slice(0, 3).map(quoteBit).join(' ');
    return `No other job in this organization is loaded to compare with ${title}. On this job, ${local || 'the clips do not add a matching line.'}`;
  }
  const term = sharedTerm(here, elsewhere);
  const take = (rows: ResearchRecord[]) => (term ? rows.filter((row) => row.text.toLowerCase().includes(term)) : rows).slice(0, 3);
  const localLines = take(here);
  const otherLines = take(elsewhere);
  const otherTitle = otherLines[0]?.clipTitle || elsewhere[0]?.clipTitle || 'the other job';
  return [
    `${title} and the similar job are both on file${term ? `, and both mention ${term}` : ''}. The two are not the same.`,
    `On this job: ${localLines.length ? localLines.map(quoteBit).join(' ') : 'no matching transcript line is on the open clips.'}`,
    `On the similar job (${otherTitle}): ${otherLines.map(quoteBit).join(' ')}`,
    `Nothing else on file ties the two jobs together.`,
  ].join('\n\n');
}

function deterministicAnswer(
  question: string,
  catalog: AskLookupCatalog,
  pad: ResearchScratchpad,
  trace: AskLookupTraceStep[],
  history?: Array<{ role?: string | null; text?: string | null }> | null,
  memory?: LongThreadMemory | null,
): string {
  // "on other jobs" already has a composer. Use it so that reply stays the one
  // the single pass writes. A similar-job comparison still quotes both files.
  if (isCrossJobQuestion(question) && !asksAboutOtherJobs(question)) {
    const cross = composeCrossJob(question, catalog, pad);
    if (cross) return cross;
  }
  const timeline = composeTimeline(question, catalog, pad);
  if (timeline) return timeline;
  return composeGroundedAsk(question, trace, catalog, history, memory);
}

/** Structured log: step timings, tool names, counts, stop reason. No transcript text. */
export function logAskResearch(trace: AskResearchTrace): void {
  logger.info('ask_research', {
    event: 'ask_research',
    stopReason: trace.stopReason,
    elapsedMs: trace.elapsedMs,
    steps: trace.steps.map((step) => ({
      step: step.step,
      tools: step.tools,
      queryCount: step.queries.length,
      added: step.added,
      total: step.total,
      ms: step.ms,
      covered: step.covered.length,
      gaps: step.gaps.length,
    })),
  });
}

export async function runAskResearch(input: {
  question: string;
  catalog: AskLookupCatalog;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  memory?: LongThreadMemory | null;
  extra?: string | null;
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
  maxSteps?: number;
  budgetMs?: number;
  /** Test double. When set, planning, sufficiency, and synthesis use it instead of the Ask model. */
  complete?: ResearchComplete | null;
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  traceSteps: AskLookupTraceStep[];
  meta: AskResearchTrace;
}> {
  const clock = input.now ?? Date.now;
  const started = clock();
  const maxSteps = input.maxSteps ?? ASK_RESEARCH_MAX_STEPS;
  const budgetMs = input.budgetMs ?? ASK_RESEARCH_BUDGET_MS;
  const pad = createResearchScratchpad();
  const traceSteps: AskLookupTraceStep[] = [];
  const ran = new Set<string>();
  const steps: AskResearchStep[] = [];
  const modelOn = Boolean(input.complete) || isAskModelConfigured(input.anthropicApiKey);
  const stable = scopeStable(input.catalog);
  let stop: AskResearchStop = 'max_steps';

  const callModel = async (kind: ResearchModelKind, user: string) => {
    const system = kind === 'plan' ? PLAN_SYSTEM : kind === 'sufficiency' ? SUFFICIENCY_SYSTEM : SYNTHESIS_SYSTEM;
    if (input.complete) {
      const turned = await input.complete({ kind, system, stable, user });
      if (!turned?.text?.trim()) throw new Error('research_model_empty');
      return { text: turned.text, model: turned.model ?? null, usage: turned.usage ?? null };
    }
    const turned = await completeAskText({
      system,
      stable,
      user,
      anthropicApiKey: input.anthropicApiKey,
      fetchFn: input.fetchFn,
      signal: input.signal,
      mode: 'interactive',
      maxTokens: kind === 'synthesis' ? 1400 : 500,
    });
    if (!turned?.text?.trim()) throw new Error('research_model_empty');
    return turned;
  };

  for (let index = 0; index < maxSteps; index += 1) {
    if (input.signal?.aborted) throw new Error('research_aborted');
    if (clock() - started >= budgetMs) {
      stop = 'budget';
      break;
    }
    const stepStarted = clock();
    let calls: ResearchCall[];
    if (modelOn) {
      const planned = await callModel(
        'plan',
        `Question: ${input.question}\n\nClip index:\n${stable}\n\nEvidence so far:\n${evidenceForModel(pad) || '(none)'}\n\nGaps still open: ${facetReport(input.question, input.catalog, pad, ran).gaps.join(', ') || 'none yet'}`,
      );
      const parsed = parseJson(planned.text);
      if (!parsed) throw new Error('research_plan_unparsed');
      calls = callsFromModel(parsed, input.question, input.catalog).filter((call) => !ran.has(callKey(call)));
    } else {
      calls = heuristicCalls(input.question, input.catalog, pad, ran);
    }
    if (!calls.length) {
      stop = 'sufficient';
      break;
    }
    const batch = await Promise.all(calls.map((call) => runCall(call, input.catalog, input.question, input.fetchFn)));
    let added = 0;
    for (const row of batch) {
      ran.add(callKey({ name: row.step.tool, input: row.step.input }));
      traceSteps.push(row.step);
      added += addResearchRecords(pad, row.records);
    }
    let covered: string[];
    let gaps: string[];
    let sufficient: boolean;
    if (modelOn) {
      const checked = await callModel(
        'sufficiency',
        `Question: ${input.question}\n\nEvidence:\n${evidenceForModel(pad) || '(none)'}`,
      );
      const parsed = parseJson(checked.text);
      if (!parsed || typeof parsed.sufficient !== 'boolean') throw new Error('research_sufficiency_unparsed');
      sufficient = parsed.sufficient === true;
      covered = Array.isArray(parsed.covered) ? parsed.covered.map((item) => String(item).slice(0, 80)) : [];
      gaps = Array.isArray(parsed.gaps) ? parsed.gaps.map((item) => String(item).slice(0, 80)) : [];
    } else {
      const report = facetReport(input.question, input.catalog, pad, ran);
      sufficient = report.sufficient;
      covered = report.covered;
      gaps = report.gaps;
    }
    steps.push({
      step: index + 1,
      queries: calls.map(queryOf),
      tools: calls.map((call) => call.name),
      added,
      total: pad.records.length,
      ms: Math.max(0, Math.round(clock() - stepStarted)),
      covered,
      gaps,
    });
    if (sufficient) {
      stop = 'sufficient';
      break;
    }
    if (index === maxSteps - 1) stop = 'max_steps';
  }

  if (!pad.records.length) throw new Error('research_empty');

  let answer: string;
  let model: string | null = null;
  let usage: MeasuredUsage | null = null;
  if (modelOn) {
    const synthesized = await callModel(
      'synthesis',
      `Question: ${input.question}\n\nEvidence:\n${evidenceForModel(pad)}\n\n${input.extra?.trim() ? `Notes:\n${input.extra.trim().slice(0, 2000)}` : ''}`,
    );
    answer = synthesized.text.trim();
    model = synthesized.model;
    usage = synthesized.usage;
  } else {
    answer = deterministicAnswer(input.question, input.catalog, pad, traceSteps, input.history, input.memory).trim();
  }
  if (!answer || /^this file does not have that\.?$/i.test(answer)) throw new Error('research_empty');

  const meta: AskResearchTrace = {
    route: 'research',
    stopReason: stop,
    steps,
    elapsedMs: Math.max(0, Math.round(clock() - started)),
  };
  logAskResearch(meta);
  return { answer, model, usage, traceSteps, meta };
}
