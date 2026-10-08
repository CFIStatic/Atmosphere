import { logAskRouteDecision, needsCriticalEscalation } from './askRoute.js';
import { looksLikeNotFound } from './askNotFound.js';
/**
 * Ask the whole job file — not only the videos.
 *
 * The office page is one file: brief facts (any keys), scope including
 * do-nots, notes, invited companies, tasks, crew, work logs, memory, uploaded
 * documents, and clip readings. A question like "what's the lockbox" or
 * "who is invited" is answerable from that record even when nothing has been
 * filmed. When a model key is wired (server ANTHROPIC_API_KEY, the org's
 * connected key, or GEMINI_API_KEY / GOOGLE_API_KEY) it writes the prose;
 * otherwise a grounded lookup still answers from the same text.
 */
import { askFastAnthropicModel, completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { answerHasJobCitation } from './askNotFound.js';
import type { AskTurnClock } from './askTiming.js';
import { answerFromAskLookup } from './askReasoning.js';
import { answerRoomQuestion, isRoomQuestion } from './roomIntelligence.js';
import { roomClipsFromCatalog } from './askLookup.js';
import type { AskResearchTrace } from './askResearch.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import { answerFromJobDocuments, chatUploadShouldAnswer, documentChunksForGrounding, documentIsJobKnowledge, sessionAnswerIsPrivate, QUIET_UNRELATED_NOTE, type AskDocumentView } from '../documents/answer.js';
import { answerChatUploadsWithModel } from './askUploadAnswer.js';
import { computerCapabilityAnswer, looksLikeComputerCapabilityAsk } from './askComputerCapability.js';
import { computerStatus } from '../computer/service.js';
import type { DocumentFacts } from '../documents/types.js';
import { isLongMemoryQuestion, type LongThreadMemory } from './askMemory.js';
import type { OrgMemoryFact } from './askOrgMemory.js';
import type { AskLookupCatalog } from './askLookup.js';
import { activitySystemAddendum } from './mentions.js';
import { ASK_PROSE_FORMAT_RULES, CHAT_VOICE_RULES, normalizeAskProse, trimChatFiller } from './askProse.js';
import { stylePromptAddendum } from './askCommunicationStyle.js';
import { mergeMeasuredUsages } from '../lib/providerUsage.js';
import { type MeasuredUsage } from '../lib/anthropic.js';
import {
  formatCollectionRecord,
  groundedCollectionAnswer,
  type CollectionClip,
} from './proofAnalyst.js';
import {
  ASK_WEB_EMPTY_RESULTS_NOTE,
  ASK_WEB_FORMAT_RULES,
  askClockSystemRules,
  askWebCapabilityRules,
  composeAskWebAnswer,
  composedAnswerIsWebProse,
  ensureWebResultsSection,
  scrubWebDerivedAskAnswer,
  formatAskWebContext,
  includeDomainsForAsk,
  looksLikePureWebCapabilityAsk,
  professionalWebCapabilityAnswer,
  searchAskWebDetailed,
  shouldSearchWebBeforeAnswer,
  asksAboutJobFile,
  looksLikeExplicitWebSearchRequest,
  looksLikeOutsideKnowledgeAsk,
  isGeneralAsk,
  type AskWebHit,
  type AskWebSearchFn,
  type AskWebSearchOutcome,
} from './askWebSearch.js';
import {
  collectWebHitsFromToolResults,
  executeAskTool,
  formatActionsTrailer,
  formatAskToolResultsForModel,
  parseJobFieldUpdatesFromQuestion,
  partitionAskTools,
  pickAskToolsHeuristically,
  type AskToolContext,
  type AskToolResult,
} from './askTools.js';

/** The one line above a Computer task card in Chat. */
export const COMPUTER_LEAD = "Opening a browser now, and I'll check with you before anything is submitted.";

export interface JobFileAskJob {
  title?: string | null;
  jobNumber?: string | number | null;
  status?: string | null;
  claimNumber?: string | null;
  policyNumber?: string | null;
  workType?: string | null;
  lossType?: string | null;
  description?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface JobFileAskScopeLine {
  state?: string | null;
  title?: string | null;
  detail?: string | null;
  reason?: string | null;
}

export interface JobFileAskMessage {
  author?: string | null;
  body?: string | null;
}

export interface JobFileAskParty {
  company?: string | null;
  trade?: string | null;
  contact?: string | null;
}

export interface JobFileAskTask {
  title?: string | null;
  status?: string | null;
  details?: string | null;
  assignee?: string | null;
}

export interface JobFileAskCrew {
  name?: string | null;
  role?: string | null;
}

export interface JobFileAskLog {
  kind?: string | null;
  body?: string | null;
  author?: string | null;
}

export interface JobFileAskDocument {
  id?: string | null;
  filename?: string | null;
  extractedText?: string | null;
  kind?: string | null;
  /** False when relevance refused the file or the office has not confirmed it. */
  attached?: boolean | null;
  relevance?: string | null;
  relevanceReason?: string | null;
  summary?: string | null;
  chunks?: Array<{ seq?: number; location: string; text: string }> | null;
  facts?: DocumentFacts | null;
}

export interface JobFileAskTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Set when this turn quoted an upload that is not on the job. */
  officeOnly?: boolean;
}

export interface JobFileAskContext {
  job?: JobFileAskJob | null;
  /** Free-form brief fields — address, lockbox, permit, or anything else on file. */
  facts?: Record<string, string> | null;
  briefNote?: string | null;
  scope?: JobFileAskScopeLine[] | null;
  messages?: JobFileAskMessage[] | null;
  parties?: JobFileAskParty[] | null;
  tasks?: JobFileAskTask[] | null;
  crew?: JobFileAskCrew[] | null;
  workLogs?: JobFileAskLog[] | null;
  memory?: Array<{ summary?: string | null }> | null;
  documents?: JobFileAskDocument[] | null;
  clips?: CollectionClip[] | null;
  /**
   * Ranked, org-scoped dossier for people @mentioned in the question.
   * When set, Ask answers from this section and does not wander into web search.
   */
  mentionSupplement?: string | null;
}

const FILE_QA_SYSTEM = `You are a sharp, friendly expert on this job file. Answer like Grok Bot: lead with the answer, natural and brief, easy to scan — never a forensic dump or a thin keyword match.

The record may contain any mix of: job identity, brief facts (any labels), scope lines including do-nots, notes and messages, invited companies, tasks, crew, work logs, memory events, uploaded documents, and video readings / mic transcripts. Treat every section as first-class evidence. A job with no video is still answerable from the rest of the file.

Rules:
1. Answer questions about this job, its videos, people, findings, or records only from the record given. Do not invent job facts, prices, or coverage decisions. Web search never replaces or overrides that evidence.
2. If the record does not contain a job-specific answer and no WEB SEARCH RESULTS apply, say "This job file does not have that" and stop. When the question is not about this job and WEB SEARCH RESULTS are provided, answer from those results for any public topic. Never invent what happened on this job from the web, and never quote web text as a speaker.
2b. Inventory questions ("what videos do we have", "how many clips", "who is on this job", "what rooms", "what days were filmed"): lead with the count from the record, then one clean bullet per item with the date, length when known, and what it shows. Never open with "nothing matches" or "this job file does not have that" when those videos or people are on the record, and never dump truncated blurbs on one semicolon-joined line.
3. LAYERED DEFAULT for broad asks: the first sentence is the answer, then a few short sentences or, only for parallel facts, a tight bullet list. Do not dump every quote or document excerpt on the first pass, and do not end with an invite or a "let me know" line.
4. GO DEEP when they ask for specifics (exact quotes, who said X, timestamps, "be specific", "more detail", full transcript): quote exactly and ground on the file (brief field, scope line, note, clip date, task, log, seek time).
5. Cite job-file sources via ⟦sources: …⟧. Do not write markdown links, bare URLs, or a Web results heading — the app attaches web sources separately. Never "(Source: …)" parentheticals or raw URL dumps in the job sentences.
6. Never estimate cost, hours, or whether work was worth paying for unless those numbers are already written on the file.
7. Speech on a recording and written notes are both evidence. For conversation topics, summarize first; only paste verbatim lines when depth was requested — never answer talk questions from vision-only room/screen descriptions.
8. Tone: warm expert colleague, plain words and contractions, no stiff disclaimers, no meta openers like "Here's a summary".
9. The raw mic transcript is authoritative for what was said and how much. An AI summary or conversation brief may be stale; when it disagrees with the transcript, follow the transcript and do not repeat the summary's claim.
10. A "how many" question (lines, utterances, quotes, times something was said) gets the number first, counted from the raw transcript lines: "There are **5** lines in the transcript." Then list them if asked.
11. When the question assumes something the file does not show (an object, a brand, an install, a person, a visual detail), say plainly that it is not in the evidence. Do not guess or answer with a nearby detail.
12. Quotes are exact transcript words only, never paraphrased inside quotation marks, each followed by the clip name and time, like “We need the permit.” (Kitchen walkthrough, 0:15).
13. Speakers: use only diarization labels ("Speaker 1") or a name the file explicitly gives that speaker. Otherwise write "an unidentified speaker" and append nothing. Never infer a name, role, posture, or relationship, and never write labels like "Person 1 (Seated…)" as a speaker.
14. Documents uploaded in this chat are evidence for questions about those files, even when they are not about this job. Answer from the full uploaded text. A summary is 2–4 sentences in your own words: do not paste the opening lines back, do not call the file an invoice or any other type unless the text or filename says it is, and do not end with a "(filename, document)" citation. A specific fact may quote an exact substring with the file name and page, like “Total: $4,280.00” (Estimate.pdf, page 1). Never comment on whether an upload is related to this job. Do not search the web for a question about an uploaded document. Do not label that answer as coming from the job file. Job-file questions still use the job record, and job evidence beats web results.

` + ASK_PROSE_FORMAT_RULES;

const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'did', 'does', 'do', 'is', 'was',
  'are', 'were', 'this', 'that', 'it', 'any', 'what', 'when', 'where', 'how', 'who', 'why',
  'video', 'videos', 'clip', 'film', 'day', 'job', 'file', 'tell', 'me', 'please',
]);

type CorpusRow = { source: string; text: string };

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function asFacts(value: JobFileAskContext['facts']): Array<{ label: string; value: string }> {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .map(([label, raw]) => ({ label: trim(label), value: trim(raw) }))
    .filter((row) => row.label && row.value);
}

export function jobFileCorpus(file: JobFileAskContext): CorpusRow[] {
  const rows: CorpusRow[] = [];
  const push = (source: string, text: string | null | undefined) => {
    const t = trim(text);
    if (t) rows.push({ source, text: t });
  };

  const job = file.job;
  if (job) {
    push('job', [job.title, job.jobNumber != null ? `Job #${job.jobNumber}` : '', job.status]
      .filter(Boolean)
      .join(' — '));
    if (job.claimNumber) push('claim', `Claim ${job.claimNumber}`);
    if (job.policyNumber) push('policy', `Policy ${job.policyNumber}`);
    if (job.workType) push('job', `Work type: ${job.workType}`);
    if (job.lossType) push('job', `Loss type: ${job.lossType}`);
    if (job.description) push('description', job.description);
    if (job.scheduledStart) push('schedule', `Scheduled start: ${job.scheduledStart}`);
    if (job.scheduledEnd) push('schedule', `Scheduled end: ${job.scheduledEnd}`);
  }

  for (const fact of asFacts(file.facts)) {
    push(`brief · ${fact.label}`, `${fact.label}: ${fact.value}`);
  }
  if (file.briefNote) push('brief note', file.briefNote);

  for (const line of file.scope ?? []) {
    const title = trim(line.title);
    if (!title) continue;
    const state = trim(line.state) || 'listed';
    const extra = [line.detail, line.reason].map(trim).filter(Boolean).join(' — ');
    push(`scope · ${state}`, `${state}: ${title}${extra ? ` — ${extra}` : ''}`);
  }

  for (const message of file.messages ?? []) {
    const body = trim(message.body);
    if (!body) continue;
    const author = trim(message.author) || 'Note';
    push(`note · ${author}`, `${author}: ${body}`);
  }

  for (const party of file.parties ?? []) {
    const company = trim(party.company);
    if (!company) continue;
    push(
      'invited',
      [company, party.trade, party.contact].map(trim).filter(Boolean).join(' · '),
    );
  }

  for (const task of file.tasks ?? []) {
    const title = trim(task.title);
    if (!title) continue;
    push(
      'task',
      [title, task.status, task.assignee, task.details].map(trim).filter(Boolean).join(' — '),
    );
  }

  for (const member of file.crew ?? []) {
    const name = trim(member.name);
    if (!name) continue;
    push('crew', [name, member.role].map(trim).filter(Boolean).join(' · '));
  }

  for (const log of file.workLogs ?? []) {
    const body = trim(log.body);
    if (!body) continue;
    push(
      'log',
      [log.kind, log.author, body].map(trim).filter(Boolean).join(' — '),
    );
  }

  for (const event of file.memory ?? []) {
    push('memory', event.summary);
  }

  for (const doc of file.documents ?? []) {
    const filename = trim(doc.filename) || 'document';
    const unattached = doc.attached === false || doc.relevance === 'not_related' || doc.relevance === 'pending_confirm';
    if (unattached) {
      const reason = trim(doc.relevanceReason);
      push(`document · ${filename}`, `${filename} is not attached to this job.${reason ? ` ${reason}` : ''}`);
      continue;
    }
    const text = trim(doc.extractedText);
    if (!text) continue;
    push(`document · ${filename}`, text.slice(0, 4000));
  }

  for (const clip of file.clips ?? []) {
    const label = [clip.workDate, clip.phase, clip.company].filter(Boolean).join(' · ') || 'clip';
    push(`clip · ${label}`, clip.summary);
    if (clip.narration && clip.narration !== clip.summary) push(`clip · ${label}`, clip.narration);
    if (clip.transcript) push(`mic · ${label}`, clip.transcript.slice(0, 2000));
    for (const change of clip.changes ?? []) push(`clip · ${label}`, change);
    for (const concern of clip.concerns ?? []) push(`clip · ${label}`, concern);
  }

  return rows;
}

export function jobFileHasContent(file: JobFileAskContext): boolean {
  return jobFileCorpus(file).length > 0;
}

export function countJobFileSources(file: JobFileAskContext): number {
  let n = 0;
  if (file.job && (file.job.title || file.job.claimNumber || file.job.description)) n += 1;
  if (asFacts(file.facts).length) n += 1;
  if (trim(file.briefNote)) n += 1;
  if ((file.scope ?? []).some((line) => trim(line.title))) n += 1;
  if ((file.messages ?? []).some((message) => trim(message.body))) n += 1;
  if ((file.parties ?? []).some((party) => trim(party.company))) n += 1;
  if ((file.tasks ?? []).some((task) => trim(task.title))) n += 1;
  if ((file.crew ?? []).some((member) => trim(member.name))) n += 1;
  if ((file.workLogs ?? []).some((log) => trim(log.body))) n += 1;
  if ((file.memory ?? []).some((event) => trim(event.summary))) n += 1;
  if ((file.documents ?? []).some((doc) => documentIsJobKnowledge(doc) && trim(doc.extractedText))) n += 1;
  n += (file.clips ?? []).length;
  return n;
}

export function formatJobFileRecord(file: JobFileAskContext): string {
  const sections: string[] = [];
  const job = file.job;
  if (job) {
    const lines = [
      job.title ? `Title: ${job.title}` : '',
      job.jobNumber != null && job.jobNumber !== '' ? `Job number: ${job.jobNumber}` : '',
      job.status ? `Status: ${job.status}` : '',
      job.claimNumber ? `Claim: ${job.claimNumber}` : '',
      job.policyNumber ? `Policy: ${job.policyNumber}` : '',
      job.workType ? `Work type: ${job.workType}` : '',
      job.lossType ? `Loss type: ${job.lossType}` : '',
      job.description ? `Description: ${job.description}` : '',
      job.scheduledStart ? `Scheduled start: ${job.scheduledStart}` : '',
      job.scheduledEnd ? `Scheduled end: ${job.scheduledEnd}` : '',
    ].filter(Boolean);
    if (lines.length) sections.push(`Job\n${lines.join('\n')}`);
  }

  const facts = asFacts(file.facts);
  if (facts.length) {
    sections.push(`Brief facts (any fields on this file)\n${facts.map((f) => `- ${f.label}: ${f.value}`).join('\n')}`);
  }
  if (trim(file.briefNote)) sections.push(`Brief note\n${trim(file.briefNote)}`);

  const scope = (file.scope ?? []).filter((line) => trim(line.title));
  if (scope.length) {
    sections.push(
      `Scope\n${scope
        .map((line) => {
          const extra = [line.detail, line.reason].map(trim).filter(Boolean).join(' — ');
          return `- [${trim(line.state) || 'listed'}] ${trim(line.title)}${extra ? ` — ${extra}` : ''}`;
        })
        .join('\n')}`,
    );
  }

  const messages = (file.messages ?? []).filter((message) => trim(message.body));
  if (messages.length) {
    sections.push(
      `Notes and messages\n${messages
        .map((message) => `- ${trim(message.author) || 'Note'}: ${trim(message.body)}`)
        .join('\n')}`,
    );
  }

  const parties = (file.parties ?? []).filter((party) => trim(party.company));
  if (parties.length) {
    sections.push(
      `Invited\n${parties
        .map((party) => `- ${[party.company, party.trade, party.contact].map(trim).filter(Boolean).join(' · ')}`)
        .join('\n')}`,
    );
  }

  const tasks = (file.tasks ?? []).filter((task) => trim(task.title));
  if (tasks.length) {
    sections.push(
      `Tasks\n${tasks
        .map((task) => `- ${[task.title, task.status, task.assignee, task.details].map(trim).filter(Boolean).join(' — ')}`)
        .join('\n')}`,
    );
  }

  const crew = (file.crew ?? []).filter((member) => trim(member.name));
  if (crew.length) {
    sections.push(
      `Crew\n${crew.map((member) => `- ${[member.name, member.role].map(trim).filter(Boolean).join(' · ')}`).join('\n')}`,
    );
  }

  const logs = (file.workLogs ?? []).filter((log) => trim(log.body));
  if (logs.length) {
    sections.push(
      `Work logs\n${logs
        .map((log) => `- ${[log.kind, log.author, log.body].map(trim).filter(Boolean).join(' — ')}`)
        .join('\n')}`,
    );
  }

  const memory = (file.memory ?? []).map((event) => trim(event.summary)).filter(Boolean);
  if (memory.length) {
    sections.push(`Recent record\n${memory.slice(0, 20).map((line) => `- ${line}`).join('\n')}`);
  }

  const docLines: string[] = [];
  for (const doc of file.documents ?? []) {
    const filename = trim(doc.filename) || 'document';
    const unattached = !documentIsJobKnowledge(doc);
    if (unattached) {
      if (!trim(doc.filename) && !trim(doc.relevanceReason)) continue;
      const reason = trim(doc.relevanceReason);
      docLines.push(`- ${filename} is not attached to this job.${reason ? ` ${reason}` : ''}`);
      continue;
    }
    const text = trim(doc.extractedText);
    if (!text) continue;
    docLines.push(`- ${filename}: ${text.slice(0, 2500)}`);
  }
  if (docLines.length) sections.push(`Uploaded documents\n${docLines.join('\n')}`);

  const supplement = trim(file.mentionSupplement);
  const priority = new Set(
    [...supplement.matchAll(/priority-clip:([0-9a-z-]{8,})/gi)].map((match) => match[1]!.toLowerCase()),
  );
  const clips = [...(file.clips ?? [])].sort((a, b) => {
    const rank = (clip: CollectionClip) => (priority.has(String(clip.proofId ?? '').toLowerCase()) ? 0 : 1);
    return rank(a) - rank(b);
  });
  if (clips.length) {
    sections.push(
      `Videos and mic\n${formatCollectionRecord(clips, supplement ? { transcriptCap: 700 } : undefined)}`,
    );
  }

  if (trim(file.mentionSupplement)) {
    sections.push(trim(file.mentionSupplement));
  }

  return sections.join('\n\n');
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function tokensOverlap(query: string, hay: string): boolean {
  if (query === hay) return true;
  if (query.length < 5 || hay.length < 5) return false;
  return hay.includes(query) || query.includes(hay);
}

function looksLikeOverview(question: string): boolean {
  return /what('?s| is) (on )?(this )?(job|file)|what do (you|we) know|summar(y|ise|ize)|overview|tell me about (this )?(job|file)/i.test(
    question,
  );
}

function sentence(value: string): string {
  const text = trim(value).replace(/\s+/g, ' ');
  if (!text) return '';
  return /[.!?…:)"”]$/.test(text) ? text : `${text}.`;
}

function plainStatus(value: unknown): string {
  return trim(value).replace(/[_-]+/g, ' ').toLowerCase();
}

/** Raw overview: compact, used by the fast-path classifier and old callers. */
function overviewFromFile(file: JobFileAskContext): string {
  const parts: string[] = [];
  if (file.job?.title) parts.push(file.job.title);
  const address = asFacts(file.facts).find((fact) => /address|site|property/i.test(fact.label));
  if (address) parts.push(address.value);
  const excluded = (file.scope ?? []).filter((line) => /exclud/i.test(trim(line.state)) && trim(line.title));
  if (excluded.length) {
    parts.push(`Do not: ${excluded.map((line) => trim(line.title)).slice(0, 3).join('; ')}`);
  }
  const clips = file.clips ?? [];
  if (clips[0]?.summary) parts.push(`Latest clip: ${clips[0].summary}`);
  else if (file.briefNote) parts.push(trim(file.briefNote));
  if (!parts.length) {
    const first = jobFileCorpus(file)[0];
    if (first) return first.text.slice(0, 400);
  }
  return parts.join('. ').slice(0, 600) || 'This job file does not have that.';
}

/** Spoken overview: lead with what the job is, then the few things that matter. */
function readableOverview(file: JobFileAskContext): string {
  const job = file.job;
  const facts = asFacts(file.facts);
  const address = facts.find((fact) => /address|site|property/i.test(fact.label));
  const lines: string[] = [];
  const title = trim(job?.title);
  if (title) {
    const where = address ? `, at ${address.value}` : '';
    const status = plainStatus(job?.status);
    lines.push(sentence(`${title}${where}${status ? ` — it's ${status}` : ''}`));
  } else if (address) {
    lines.push(sentence(`This job is at ${address.value}`));
  }
  const description = trim(job?.description);
  if (description) lines.push(sentence(description));
  else if (trim(file.briefNote)) lines.push(sentence(trim(file.briefNote)));
  const excluded = (file.scope ?? []).filter((line) => /exclud/i.test(trim(line.state)) && trim(line.title));
  if (excluded.length) {
    const titles = excluded.map((line) => trim(line.title)).slice(0, 3);
    lines.push(
      titles.every((t) => /^(do not|don'?t|never|no)\b/i.test(t))
        ? titles.map(sentence).join(' ')
        : sentence(`Out of scope: ${titles.join('; ')}`),
    );
  }
  const latest = trim(file.clips?.[0]?.summary);
  if (latest) lines.push(sentence(`Latest video: ${latest}`));
  if (lines.length) return lines.join(' ').slice(0, 700);
  const first = jobFileCorpus(file)[0];
  return first ? readableRow(first) : 'This job file does not have that.';
}

/** One corpus row as a plain sentence, without internal section tags. */
function readableRow(row: CorpusRow): string {
  const source = row.source;
  const text = trim(row.text).replace(/\s+/g, ' ');
  if (source.startsWith('brief · ')) {
    const label = source.slice('brief · '.length);
    const value = text.startsWith(`${label}:`) ? trim(text.slice(label.length + 1)) : text;
    return sentence(`${label}: ${value}`);
  }
  if (source.startsWith('scope · ')) {
    const state = source.slice('scope · '.length);
    const body = text.startsWith(`${state}:`) ? trim(text.slice(state.length + 1)) : text;
    if (/exclud/i.test(state)) {
      return /^(do not|don'?t|never|no)\b/i.test(body) ? sentence(body) : sentence(`Out of scope: ${body}`);
    }
    if (/^(included|listed|in[_ ]?scope)$/i.test(state)) return sentence(`In scope: ${body}`);
    return sentence(`${plainStatus(state).replace(/^./, (c) => c.toUpperCase())}: ${body}`);
  }
  if (source.startsWith('note · ')) return sentence(text);
  if (source.startsWith('document · ')) {
    const name = source.slice('document · '.length);
    return sentence(`${name}: ${text.slice(0, 400)}`);
  }
  if (source.startsWith('clip · ') || source.startsWith('mic · ')) {
    const label = source.replace(/^(clip|mic) · /, '');
    const lead = source.startsWith('mic') ? 'On the mic' : 'In the video';
    return sentence(`${lead} (${label}): ${text.slice(0, 400)}`);
  }
  switch (source) {
    case 'invited':
      return sentence(`Invited: ${text}`);
    case 'task':
      return sentence(`Task: ${text}`);
    case 'crew':
      return sentence(`Crew: ${text}`);
    case 'brief note':
    case 'description':
    case 'memory':
    case 'log':
    case 'schedule':
    case 'claim':
    case 'policy':
    case 'job':
    default:
      return sentence(text);
  }
}

const SMALL_TALK_RE =
  /^(?:\?+|hi|hey|hello|yo|thanks|thank you|thx|ty|ok|okay|k|cool|got it|great|nice|perfect|sounds good)[\s!.?]*$/i;

/** "?", "ok", "thanks", "hi": conversation, not a question the file failed to answer. */
export function isChatSmallTalk(question: string): boolean {
  return SMALL_TALK_RE.test(trim(question));
}

function smallTalkReply(question: string): string | null {
  const q = trim(question);
  if (!SMALL_TALK_RE.test(q)) return null;
  if (/^\?+$/.test(q)) {
    return "What do you want to know? I can pull up the scope, who's on the job, what the videos show, or anything in the files.";
  }
  if (/^(thanks|thank you|thx|ty)/i.test(q)) return "You're welcome.";
  if (/^(hi|hey|hello|yo)/i.test(q)) return "Hi! What do you want to know about this job?";
  return 'Got it.';
}

type GroundedLookup =
  | { kind: 'empty' }
  | { kind: 'overview' }
  | { kind: 'none' }
  | { kind: 'clips'; text: string }
  | { kind: 'rows'; rows: CorpusRow[] };

function lookupJobFile(question: string, file: JobFileAskContext): GroundedLookup {
  const rows = jobFileCorpus(file);
  if (!rows.length) return { kind: 'empty' };
  if (looksLikeOverview(question)) return { kind: 'overview' };

  const words = tokens(question);
  if (!words.length) return { kind: 'overview' };

  const need = words.some((word) => word.length >= 6) ? 1 : Math.min(words.length >= 2 ? 2 : 1, words.length);
  const scored = rows
    .map((row) => {
      const hay = tokens(`${row.source} ${row.text}`);
      const hits = words.filter((token) => hay.some((h) => tokensOverlap(token, h) || h === token));
      return { row, score: hits.length };
    })
    .filter((entry) => entry.score >= need)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    // Clip-only keyword path still helps "what did the videos show" wording.
    if ((file.clips ?? []).length && /video|clip|film|footage|mic|said/i.test(question)) {
      return { kind: 'clips', text: groundedCollectionAnswer(question, file.clips ?? []) };
    }
    return { kind: 'none' };
  }
  return { kind: 'rows', rows: scored.slice(0, 2).map(({ row }) => row) };
}

/**
 * Deterministic answer from whatever is already on the file, in its raw
 * "section: text" form. Routing (fast path, web supplement) reads this shape.
 */
export function groundedJobFileAnswer(question: string, file: JobFileAskContext): string {
  const hit = lookupJobFile(question, file);
  switch (hit.kind) {
    case 'empty':
      return 'Nothing is on this job file yet, so there is nothing to answer from.';
    case 'overview':
      return overviewFromFile(file);
    case 'none':
      return 'This job file does not have that.';
    case 'clips':
      return hit.text;
    case 'rows':
      return hit.rows
        .map((row) => `${row.source}: ${row.text}`.replace(/\s+/g, ' ').trim())
        .join(' ')
        .slice(0, 700);
  }
}

/**
 * The same deterministic answer, written for the person reading Chat: no
 * internal section tags ("brief ·", "scope · excluded"), no doubled labels,
 * and a friendly reply to "?", "ok" or "thanks". Used when no model key is
 * wired, on the fast path, and as a fallback if the model call fails.
 */
export function readableJobFileAnswer(question: string, file: JobFileAskContext): string {
  const hit = lookupJobFile(question, file);
  if (hit.kind === 'none' || hit.kind === 'overview') {
    const small = smallTalkReply(question);
    if (small) return small;
  }
  switch (hit.kind) {
    case 'empty':
      return smallTalkReply(question) ?? "There's nothing on this job file yet, so I don't have anything to answer from.";
    case 'overview':
      return readableOverview(file);
    case 'none':
      return 'This job file does not have that.';
    case 'clips':
      return sentence(hit.text);
    case 'rows': {
      const lines = [...new Set(hit.rows.map(readableRow).filter(Boolean))];
      return lines.join(' ').slice(0, 700);
    }
  }
}

/**
 * Prefer the grounded file hit when it is already a clear brief/field answer
 * or a simple overview — skip the model for near-instant Ask.
 */
export function preferJobFileGroundedFastPath(question: string, grounded: string): boolean {
  if (/does not have that|Nothing is on this job file/i.test(grounded)) return false;
  // Money / deadline / safety / dispute must escalate — never answer from a brief field alone.
  if (needsCriticalEscalation(question)) return false;
  // Never fast-path web / outside-knowledge / capability asks — those need searchAskWeb
  // (or a model answer about web access), not a brief-note hit from the job file.
  if (looksLikeOutsideKnowledgeAsk(question) || looksLikeExplicitWebSearchRequest(question)) return false;
  // Public questions are not answered from a coincidental brief hit.
  if (!asksAboutJobFile(question) && !/^(?:hi|hey|hello|thanks|thank you|ok|okay)\b/i.test(question.trim())) {
    return false;
  }
  if (looksLikeOverview(question)) return true;
  // Clear labelled hits from the corpus ("brief · Permit: …", "claim: …").
  if (
    /^(brief|claim|policy|job|scope|note|invited|task|crew|log|description|schedule)\b/i.test(grounded) &&
    grounded.length < 500 &&
    !/\b(why|explain|compare|summar)/i.test(question)
  ) {
    return true;
  }
  return false;
}

/**
 * The exact system and user text a mention question sends to the model:
 * job file (their clips first, transcripts trimmed), attribution dossier,
 * and recent turns. Web and tool blocks are empty unless a caller has them.
 */
export function assembleMentionModelPrompt(input: {
  question: string;
  file: JobFileAskContext;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  webBlock?: string;
  toolBlock?: string;
  extraSystem?: string;
}): { system: string; user: string } {
  const supplement = trim(input.file.mentionSupplement);
  const history = (input.history ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text)}`)
    .join('\n');
  const record = formatJobFileRecord(input.file).trim();
  const addendum =
    activitySystemAddendum(supplement) ??
    `\n\nThe question @mentions a coworker, or a follow-up pronoun refers to the last person they named. Answer that question from the attribution dossier and the job file. Stay strictly grounded. If it is not in the file, say so. Cite clips and dates with ⟦sources: job/<jobId>/<slug>, video/<jobId>/<proofId>/<slug>, clip:YYYY-MM-DD⟧ and do not put raw tags in the sentences. Never write [[web:…]].`;
  const system = FILE_QA_SYSTEM + addendum + (input.extraSystem ?? '');
  const user =
    `Job file record:\n\n${record || '(empty record)'}` +
    (input.webBlock ?? '') +
    (input.toolBlock ?? '') +
    (history ? `\n\nEarlier questions on this file:\n${history}` : '') +
    `\n\nQuestion: ${input.question}`;
  return { system, user };
}

function webFallbackAnswer(input: {
  question: string;
  jobAnswer?: string | null;
  webAnswer?: string | null;
  hits: AskWebHit[];
}): { answer: string; webDerived: boolean } {
  const answer = composeAskWebAnswer(input);
  const webDerived = composedAnswerIsWebProse(input);
  return { answer: webDerived ? scrubWebDerivedAskAnswer(answer) : answer, webDerived };
}

const GENERAL_ANSWER_SYSTEM = `You answer a contractor's quick public question in Chat (sports, weather, news, codes, products, prices) from the WEB SEARCH RESULTS given.

${CHAT_VOICE_RULES}

Rules:
- Lead with a direct, useful answer in 1–3 short sentences, like a sharp friend who just checked. Never open with what you could not find.
- Predictions ("who's going to win", "will it rain"): give a quick take. Say who is favored and the one or two reasons the results support (odds, records, standings, starters, home field, forecast). One light hedge at most.
- A vague subject ("the ball game", "the game tonight"): use CURRENT DATE AND TIME and cover the one or two most likely matches in a line each. Do not ask which one.
- Scores, times, odds, prices, and names must come from the results. If the results are thin, give the best general take and say in one short clause that live details were not in the results.
- A short "-" list only for a schedule or a few options, one item per line, in your own words.
- No links or URLs, no headings, no "[...]", no quotation marks around web text, no page labels. The app shows the sources separately.`;

/**
 * A public question with nothing to do with the job: one web search (often
 * already running from the start of the turn) and one fast, streamed answer.
 * No job lookup loop, no second search round, no reasoning model.
 */
export async function answerGeneralQuestion(input: {
  question: string;
  history?: JobFileAskTurn[] | null;
  apiKey?: string | null;
  webSearch?: AskWebSearchFn | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  onStatus?: (phase: string) => void;
  signal?: AbortSignal;
  timing?: AskTurnClock | null;
  now?: Date;
  timeZone?: string;
  complete?: typeof completeAskText;
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  webHits: AskWebHit[];
  webAnswer: string;
} | null> {
  const zone = input.timeZone || 'America/Chicago';
  input.onStatus?.('Searching the web…');
  const started = performance.now();
  const search = input.webSearch ?? ((query: string, opts?: Parameters<AskWebSearchFn>[1]) => searchAskWebDetailed(query, opts));
  const outcome: AskWebSearchOutcome = await search(input.question, {
    fetchFn: input.fetchFn,
    limit: 5,
    includeDomains: includeDomainsForAsk(input.question),
    now: input.now,
    timeZone: zone,
  }).catch(() => ({ hits: [], answer: '' }));
  input.timing?.addTool('web_search', performance.now() - started);
  if (input.signal?.aborted) return null;
  const complete = input.complete ?? completeAskText;
  if (!input.complete && !isAskModelConfigured(trim(input.apiKey) || null)) return null;
  const history = (input.history ?? [])
    .filter((turn) => trim(turn.text) && turn.officeOnly !== true)
    .slice(-6)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text).slice(0, 600)}`)
    .join('\n');
  const results = formatAskWebContext(outcome.hits, outcome.answer);
  input.onStatus?.('Writing the answer…');
  const completed = await complete({
    system: `${GENERAL_ANSWER_SYSTEM}\n\n${askClockSystemRules(input.now ?? new Date(), zone)}`,
    user:
      `WEB SEARCH RESULTS (public web):\n${results || '(none: live search returned nothing usable)'}` +
      (history ? `\n\nEarlier in this chat:\n${history}` : '') +
      `\n\nQuestion: ${input.question}`,
    anthropicApiKey: trim(input.apiKey) || null,
    anthropicModel: askFastAnthropicModel(),
    mode: 'interactive',
    maxTokens: 600,
    onToken: input.onToken,
    signal: input.signal,
    fetchFn: input.fetchFn,
  }).catch(() => null);
  const text = completed?.text
    ? scrubWebDerivedAskAnswer(ensureWebResultsSection(normalizeAskProse(completed.text)))
    : '';
  if (!trim(text)) return null;
  return {
    answer: trimChatFiller(text, { question: input.question }),
    model: completed?.model ?? null,
    usage: completed?.usage ?? null,
    webHits: outcome.hits,
    webAnswer: outcome.answer,
  };
}

const WEB_SUMMARY_SYSTEM = `You answer one public question for a contractor's Chat from the WEB SEARCH RESULTS given. Write the answer yourself.

${CHAT_VOICE_RULES}

Rules:
- Lead with the answer in 1–3 short plain sentences. A schedule, a set of scores or a few options may be a short "-" list, one item per line, each in your own words.
- Use only what the results say. If they do not answer the question, say so in one sentence. Never invent games, times, prices, names or URLs.
- Never paste or stitch together result text. No markdown headings (#), no "[...]", no page labels ("Team Logo", "Watch Replay", "Final"), no links or URLs, no quotation marks around web text. The app shows the sources separately.`;

/**
 * The job-file model declined a public question (or wrote nothing) although
 * web results came back. Write a short answer from those results with the
 * same Chat model, instead of pasting a raw result snippet. Null when no
 * model is configured or it fails; the caller then uses composeAskWebAnswer.
 */
export async function summarizeWebResultsForAsk(input: {
  question: string;
  hits: AskWebHit[];
  webAnswer: string;
  apiKey?: string | null;
  fetchFn?: typeof fetch;
  now?: Date;
  timeZone?: string;
  complete?: typeof completeAskText;
}): Promise<{ answer: string; model: string | null; usage: MeasuredUsage | null } | null> {
  if (!input.hits.length && !trim(input.webAnswer)) return null;
  const complete = input.complete ?? completeAskText;
  if (!input.complete && !isAskModelConfigured(trim(input.apiKey) || null)) return null;
  try {
    const completed = await complete({
      system: `${WEB_SUMMARY_SYSTEM}\n\n${askClockSystemRules(input.now ?? new Date(), input.timeZone || 'America/Chicago')}`,
      user: `WEB SEARCH RESULTS (public web):\n${formatAskWebContext(input.hits, input.webAnswer)}\n\nQuestion: ${input.question}`,
      anthropicApiKey: trim(input.apiKey) || null,
      anthropicModel: askFastAnthropicModel(),
      mode: 'interactive',
      maxTokens: 500,
      fetchFn: input.fetchFn,
    });
    const text = completed?.text ? scrubWebDerivedAskAnswer(ensureWebResultsSection(normalizeAskProse(completed.text))) : '';
    if (!trim(text)) return null;
    return { answer: trimChatFiller(text, { question: input.question }), model: completed?.model ?? null, usage: completed?.usage ?? null };
  } catch {
    return null;
  }
}

type WebSummaryOptions = Omit<Parameters<typeof summarizeWebResultsForAsk>[0], 'question' | 'hits' | 'webAnswer'>;

async function applyWebResults(
  answer: string,
  question: string,
  hits: AskWebHit[],
  webAnswer: string,
  summary?: WebSummaryOptions,
): Promise<{ answer: string; webDerived: boolean; usage?: MeasuredUsage | null }> {
  const stripped = ensureWebResultsSection(answer);
  if (!hits.length && !trim(webAnswer)) return { answer: stripped, webDerived: false };
  const refused =
    /does not have that|not on (this )?file|cannot search|can't search|unable to search|do not have (web|internet) access|aren'?t connected/i.test(
      answer,
    );
  if (!asksAboutJobFile(question) && (refused || !trim(stripped))) {
    // Write a clean answer from the results; never paste raw result text.
    const written = summary ? await summarizeWebResultsForAsk({ ...summary, question, hits, webAnswer }) : null;
    if (written) return { answer: written.answer, webDerived: true, usage: written.usage };
    return webFallbackAnswer({ question, jobAnswer: '', webAnswer, hits });
  }
  return { answer: stripped, webDerived: false };
}

function documentViews(file: JobFileAskContext): AskDocumentView[] {
  return (file.documents ?? []).flatMap((doc) => {
    const filename = trim(doc.filename);
    const text = trim(doc.extractedText);
    if (!filename && !text) return [];
    return [{
      id: trim(doc.id) || filename || 'document',
      filename: filename || 'document',
      kind: doc.kind,
      attached: doc.attached,
      relevance: doc.relevance,
      relevanceReason: doc.relevanceReason,
      summary: doc.summary,
      extractedText: doc.extractedText,
      chunks: doc.chunks,
      facts: doc.facts,
    }];
  });
}

/**
 * A document miss is final only when the question names an upload.
 * "Who is invited on the file?" must not stop at "This document does not show that."
 */
function keepDocumentAnswer(question: string, answer: string): boolean {
  if (
    /\b(document|pdf|spreadsheet|workbook|uploaded|attachment|estimate|invoice|contract|change\s+order|floor\s*plan|sketch|permit|photo)\b/i.test(
      question,
    )
  ) {
    return true;
  }
  // "this file" / "the file" are the job. Do not let an upload hit or abstain replace it.
  if (/\b(?:this|the)\s+file\b/i.test(question)) return false;
  return !/^this document does not show that\.?$/i.test(answer.trim());
}

/**
 * Answers from files the office user uploaded in this chat, including ones
 * that are not on the job. Job questions and questions about a different
 * document kind fall through so the job file stays first.
 */
function readableUploads(documents: AskDocumentView[] | null | undefined): AskDocumentView[] {
  return (documents ?? []).filter((doc) => trim(doc.extractedText) || (doc.chunks ?? []).some((chunk) => trim(chunk.text)));
}

/** No model: a deterministic answer from the upload text (never a text dump). */
function answerFromChatUploads(
  question: string,
  documents: AskDocumentView[] | null | undefined,
): string | null {
  const readable = readableUploads(documents);
  if (!chatUploadShouldAnswer(question, readable)) return null;
  const direct = answerFromJobDocuments(question, readable, []);
  if (!direct) return 'This document does not show that.';
  return enforceQuoteGrounding(normalizeAskProse(direct), {
    chunks: documentChunksForGrounding(readable, { includeUploads: true }),
    question,
  }).answer;
}

function privateUploadText(doc: AskDocumentView): string {
  const extracted = trim(doc.extractedText);
  if (extracted) return extracted;
  return (doc.chunks ?? []).map((chunk) => trim(chunk.text)).filter(Boolean).join('\n');
}

function normalizedAskText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when prose repeats an unattached upload: its filename or a real span of
 * its text. Job-file answers must not be stored on the shared record in that case.
 */
export function answerQuotesPrivateUpload(
  answer: string,
  documents: AskDocumentView[] | null | undefined,
): boolean {
  const prose = normalizedAskText(answer);
  if (!prose) return false;
  for (const doc of documents ?? []) {
    if (documentIsJobKnowledge(doc)) continue;
    const filename = normalizedAskText(doc.filename ?? '');
    if (filename.length > 3 && prose.includes(filename)) return true;
    const body = privateUploadText(doc);
    if (!body) continue;
    const flat = normalizedAskText(body);
    if (flat.length >= 24 && prose.includes(flat.slice(0, 120))) return true;
    for (const line of body.split(/\n/)) {
      const row = normalizedAskText(line);
      if (row.length >= 24 && prose.includes(row.slice(0, 120))) return true;
    }
  }
  return false;
}

/** Drop earlier upload answers before a job or public question reaches the model. */
export function historyWithoutPrivateUploads(
  history: JobFileAskTurn[] | null | undefined,
  documents: AskDocumentView[] | null | undefined,
): JobFileAskTurn[] | undefined {
  if (!history?.length) return history ?? undefined;
  const hasPrivateDocs = (documents ?? []).some((doc) => !documentIsJobKnowledge(doc));
  const hasOfficeOnly = history.some((turn) => turn.officeOnly === true);
  if (!hasPrivateDocs && !hasOfficeOnly) return history;
  const quiet = normalizedAskText(QUIET_UNRELATED_NOTE);
  return history.filter((turn) => {
    if (turn.officeOnly === true) return false;
    if (!hasPrivateDocs) return true;
    const text = normalizedAskText(turn.text ?? '');
    if (text.includes(quiet)) return false;
    return !answerQuotesPrivateUpload(turn.text ?? '', documents);
  });
}

/** Deterministic document answers. Quotes are exact substrings, cited with the file and location. */
function answerFromAttachedDocuments(question: string, file: JobFileAskContext): string | null {
  const views = documentViews(file);
  if (!views.length) return null;
  const evidence = (file.clips ?? []).map((clip) => ({
    source: [clip.workDate, clip.phase, clip.company].filter(Boolean).join(' · ') || 'Video',
    text: [clip.summary, clip.narration, clip.transcript].map(trim).filter(Boolean).join('\n'),
  }));
  const direct = answerFromJobDocuments(question, views, evidence);
  if (!direct) return null;
  return enforceQuoteGrounding(direct, {
    chunks: documentChunksForGrounding(views),
    question,
  }).answer;
}

/**
 * True when this thread already stored the same answer moments ago.
 * A stream failure that retries as JSON must not insert a second turn.
 */
export function isDuplicateAskTurn(
  recent: { answer?: string | null; thread_id?: string | null } | null | undefined,
  threadId: string | null | undefined,
  answer: string,
): boolean {
  if (!recent) return false;
  const sameThread = !threadId || !recent.thread_id || recent.thread_id === threadId;
  return sameThread && String(recent.answer ?? '').trim() === answer.trim();
}


/** Never attach web results to a job not-found answer. */
export function clearWebOnNotFound<T extends { answer: string; webHits?: unknown[]; webDerivedAnswer?: boolean }>(
  result: T,
): T {
  const ans = String(result.answer ?? '');
  if (!looksLikeNotFound(ans) && !/^Not found\./i.test(ans)) return result;
  return { ...result, webHits: [], webDerivedAnswer: false };
}

/**
 * True when this reply leans on web results and nothing in it points back to
 * the job (no clip, document, or field citation). Such a reply must not carry
 * the "From this job file" line.
 */
export function webBackedWithoutJobCite(
  answer: string,
  webHits: AskWebHit[] | null | undefined,
  webAnswer: string | null | undefined,
  webDerived?: boolean,
): boolean {
  if (webDerived) return true;
  const usedWeb = (webHits?.length ?? 0) > 0 || Boolean(trim(webAnswer));
  if (!usedWeb) return false;
  return !answerHasJobCitation(answer);
}

export async function answerFromJobFile(input: {
  question: string;
  file: JobFileAskContext;
  history?: JobFileAskTurn[];
  /** Summary of older turns and durable notes. Recent history stays verbatim. */
  memory?: LongThreadMemory | null;
  /** Company-wide org memory (already access-filtered). */
  orgMemory?: OrgMemoryFact[] | null;
  apiKey?: string | null;
  onToken?: (text: string) => void;
  /** Lookup status while tools run ("Looking through clips…"). */
  onStatus?: (phase: string) => void;
  /** Set when the reader stops the answer. A stopped turn is not stored. */
  signal?: AbortSignal;
  /** Optional fetch override for tests. */
  fetchFn?: typeof fetch;
  /**
   * When set, mention and job-file questions look facts up with tools on the
   * reasoning model instead of one transcript dump.
   */
  lookup?: AskLookupCatalog | null;
  /**
   * When set, Ask may run safe in-product tools (web search, job field
   * get/update, punch list, drafts). Updates are office-only.
   */
  toolContext?: AskToolContext | null;
  /** Per-turn timings. Tool inputs are not recorded. */
  timing?: AskTurnClock | null;
  /** Pins relative dates such as "Thursday" in tests. */
  now?: Date;
  /**
   * Files uploaded in this office chat. They are not job-file evidence and
   * are ignored for share and homeowner Ask.
   */
  sessionDocuments?: AskDocumentView[] | null;
  /** Test hook for the upload answer completion. */
  uploadComplete?: typeof completeAskText;
  /**
   * Compact per-user communication-style summary (tone/length/format only).
   * Never overrides grounding, speakers, or job-evidence rules.
   */
  styleSummary?: string | null;
  /**
   * Per-turn memoized web search. The HTTP turn starts it for public questions
   * while the job file is still loading, so the search is usually done by the
   * time the answer needs it.
   */
  webSearch?: AskWebSearchFn | null;
  /** Clear the reader's live preview (a tool call after a preface, an escalation). */
  onPreviewReset?: () => void;
  /** Install the sentence check the live preview runs before showing text. */
  setPreviewCheck?: (check: ((sentence: string) => boolean) | null) => void;
  /** Test hook for the general (public question) answer. */
  generalComplete?: typeof completeAskText;
}): Promise<{
  answer: string;
  model: string | null;
  groundedOn: number;
  usage: MeasuredUsage | null;
  webHits: AskWebHit[];
  toolResults: AskToolResult[];
  /** True when the reply came from the lookup tools, including a failed-model grounding. */
  answeredFromLookup?: boolean;
  /** The reply is about a chat upload, not the job file. */
  answeredFromSessionDocument?: boolean;
  /**
   * True when the reply quotes an upload that is not on this job. Store it on
   * the office thread only; shared and grant listings omit it.
   */
  officeOnly?: boolean;
  /** The stored prose is web text. Marker parsing must not treat it as a model answer. */
  webDerivedAnswer?: boolean;
  /** Compact research trace for debugging. Absent on the single pass. */
  research?: AskResearchTrace | null;
}> {
  const emit = (text: string) => {
    if (text) input.timing?.markFirstToken();
    input.onToken?.(text);
  };
  const logSkipped = (reason: string) => {
    void logAskRouteDecision({
      orgId: input.lookup?.orgId ?? input.toolContext?.orgId ?? null,
      jobId: input.lookup?.jobId ?? input.toolContext?.jobId ?? null,
      question: input.question,
      route: 'skipped',
      reason,
      unsure: false,
    });
    input.timing?.noteRoute('skipped', reason);
  };
  const grounded = groundedJobFileAnswer(input.question, input.file);
  // What the reader sees when the deterministic path answers.
  const spoken = readableJobFileAnswer(input.question, input.file);
  // "From this job file" only under answers that came from it, not "You're welcome."
  const spokenFromJob = !isChatSmallTalk(input.question) && !/does not have that/i.test(spoken);
  const groundedOn = countJobFileSources(input.file);
  const apiKey = (input.apiKey ?? '').trim();
  const empty = {
    answer: spoken,
    model: null as string | null,
    groundedOn: 0,
    usage: null as MeasuredUsage | null,
    webHits: [] as AskWebHit[],
    toolResults: [] as AskToolResult[],
  };

  // "What websites can you log in to?" is about Chat, not the file or an upload.
  if (looksLikeComputerCapabilityAsk(input.question)) {
    logSkipped('skipped_computer_capability');
    const answer = computerCapabilityAnswer({
      access: input.toolContext?.access === 'org' ? 'org' : 'viewer',
      configured: computerStatus().configured,
    });
    emit(answer);
    return { ...empty, answer, groundedOn: 0, toolResults: [], webHits: [] };
  }

  // Capability-only ("can you search Google?") → short professional yes, no live
  // search, no model star soup / google.com junk citations.
  if (looksLikePureWebCapabilityAsk(input.question)) {
    logSkipped('skipped_web_capability');
    const answer = professionalWebCapabilityAnswer(input.question);
    emit(answer);
    return { ...empty, answer, groundedOn: 0, toolResults: [], webHits: [] };
  }

  const sessionCovers = chatUploadShouldAnswer(input.question, input.sessionDocuments);
  const officeOnly = sessionAnswerIsPrivate(input.question, input.sessionDocuments);
  if (sessionCovers) {
    // The model reads the attached file and answers in its own words.
    if (input.uploadComplete || isAskModelConfigured(apiKey || null)) {
      const modeled = await answerChatUploadsWithModel({
        question: input.question,
        documents: readableUploads(input.sessionDocuments),
        history: input.history,
        apiKey: apiKey || null,
        fetchFn: input.fetchFn,
        signal: input.signal,
        complete: input.uploadComplete,
        // Stream the upload answer; the preview holds back quotes until the
        // exact-substring check on the final.
        onToken: emit,
      }).catch(() => null);
      if (modeled) input.timing?.noteRoute('fast', 'upload');
      if (modeled) {
        return {
          ...empty,
          answer: modeled.answer,
          model: modeled.model,
          usage: modeled.usage,
          groundedOn: 0,
          answeredFromSessionDocument: true,
          officeOnly,
        };
      }
    }
    const fromUploads = answerFromChatUploads(input.question, input.sessionDocuments) ?? 'This document does not show that.';
    emit(fromUploads);
    return { ...empty, answer: fromUploads, groundedOn: 0, answeredFromSessionDocument: true, officeOnly };
  }

  const fromDocuments = answerFromAttachedDocuments(input.question, input.file);
  if (fromDocuments && keepDocumentAnswer(input.question, fromDocuments)) {
    emit(fromDocuments);
    return { ...empty, answer: fromDocuments, groundedOn };
  }

  const heuristicPicks = input.toolContext ? pickAskToolsHeuristically(input.question, input.toolContext.access) : [];
  const generalTurn =
    !trim(input.file.mentionSupplement) &&
    isGeneralAsk(input.question) &&
    heuristicPicks.every((name) => name === 'web_search') &&
    (Boolean(input.generalComplete) || isAskModelConfigured(apiKey || null));
  if (generalTurn) {
    const general = await answerGeneralQuestion({
      question: input.question,
      history: input.history,
      apiKey: apiKey || null,
      webSearch: input.webSearch ?? null,
      fetchFn: input.fetchFn,
      onToken: emit,
      onStatus: input.onStatus,
      signal: input.signal,
      timing: input.timing,
      now: input.now,
      timeZone: input.lookup?.timeZone || 'America/Chicago',
      complete: input.generalComplete,
    });
    if (general) {
      input.timing?.noteRoute('general', 'general_web');
      input.timing?.noteModel(general.model);
      void logAskRouteDecision({
        orgId: input.lookup?.orgId ?? input.toolContext?.orgId ?? null,
        jobId: input.lookup?.jobId ?? input.toolContext?.jobId ?? null,
        question: input.question,
        route: 'fast',
        reason: 'general_web',
        unsure: false,
        modelHint: general.model ?? 'fast',
      });
      return {
        ...empty,
        answer: general.answer,
        model: general.model,
        usage: general.usage,
        groundedOn: 0,
        webHits: general.webHits,
        toolResults: [],
        webDerivedAnswer: true,
      };
    }
    // No model reply: fall through to the normal path (it still has the search).
  }

  // Run safe tools first so field updates apply before the model writes prose.
  let toolResults: AskToolResult[] = [];
  let webHits: AskWebHit[] = [];
  if (input.toolContext && !sessionCovers) {
    const picks = heuristicPicks;
    const { sequential, parallel } = partitionAskTools(picks);
    const runTool = async (name: (typeof picks)[number]) => {
      const rawInput =
        name === 'web_search'
          ? { query: input.question, include_domains: includeDomainsForAsk(input.question) }
          : name === 'find_evidence_moments'
            ? { topic: input.question }
            : name === 'search_crm'
              ? { query: input.question }
            : name === 'start_computer_task'
              ? { instructions: input.question }
            : name === 'update_job_fields'
              ? parseJobFieldUpdatesFromQuestion(input.question)
              : name === 'propose_revoke_access'
                ? {
                    personLabel:
                      input.question.match(/revoke(?:\s+access)?(?:\s+for)?\s+(.+)$/i)?.[1] ??
                      input.question,
                  }
                : {};
      const started = performance.now();
      const result = await executeAskTool(name, rawInput, {
        ...input.toolContext!,
        fetchFn: input.fetchFn ?? input.toolContext!.fetchFn,
        file: input.file,
        webSearch: input.webSearch ?? input.toolContext!.webSearch,
      });
      input.timing?.addTool(name, performance.now() - started);
      return result;
    };
    if (picks.includes('start_computer_task')) input.onStatus?.('Starting Computer…');
    for (const name of sequential) toolResults.push(await runTool(name));
    if (parallel.length) toolResults.push(...(await Promise.all(parallel.map((name) => runTool(name)))));
    webHits = collectWebHitsFromToolResults(toolResults);
  }

  // A browser task is the whole turn: one short line, then the card.
  const computer = toolResults.find((r) => r.tool === 'start_computer_task');
  if (computer) {
    const lead = computer.ok
      ? computer.summary || COMPUTER_LEAD
      : computer.ui?.path === 'computer-task:not-set-up'
        ? "I can't work in a browser for you yet."
        : computer.summary;
    const answer = `${lead}\n\n${formatActionsTrailer([computer])}`;
    emit(answer);
    return { ...empty, answer, groundedOn: 0, toolResults };
  }

  const zone = input.lookup?.timeZone || 'America/Chicago';
  let webAnswer = toolResults
    .map((result) => {
      const data = result.data;
      if (!data || typeof data !== 'object') return '';
      return String((data as { answer?: string }).answer ?? '');
    })
    .find((text) => text.trim()) ?? '';

  const mentionScoped = Boolean(trim(input.file.mentionSupplement));
  if (!mentionScoped && !jobFileHasContent(input.file) && !toolResults.some((r) => r.ok)) {
    logSkipped('skipped_empty_job');
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: 0, toolResults };
  }

  // Prefer tools when they answered (status/fields/update) — still allow model
  // polish when a key is configured, but skip the grounded fast-path so updates
  // are not ignored.
  const toolsHandled =
    toolResults.some((r) => r.ok && ['update_job_fields', 'get_job_fields', 'get_job_status', 'get_crm_record', 'search_crm', 'list_who_has_access', 'get_punch_list', 'propose_revoke_access', 'draft_progress_share_copy', 'draft_field_invite_copy'].includes(r.tool));

  // Proactive web search BEFORE grounded fast-path so capability / outside-knowledge
  // asks (e.g. "search the web for tile prices", "can u search google") are never
  // swallowed by a brief-note hit from the job file.
  let webSearchAttempted = false;
  if (!sessionCovers && !mentionScoped && !webHits.length && !webAnswer.trim() && shouldSearchWebBeforeAnswer(input.question, grounded)) {
    webSearchAttempted = true;
    const outcome = await (input.webSearch ?? searchAskWebDetailed)(input.question, {
      fetchFn: input.fetchFn,
      limit: 5,
      includeDomains: includeDomainsForAsk(input.question),
      now: input.now,
      timeZone: zone,
    });
    webHits = outcome.hits;
    webAnswer = outcome.answer || webAnswer;
  }

  const webUsable = webHits.length > 0 || Boolean(trim(webAnswer));

  if (
    !mentionScoped &&
    !toolsHandled &&
    !isLongMemoryQuestion(input.question) &&
    preferJobFileGroundedFastPath(input.question, grounded) &&
    !webUsable
  ) {
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: spokenFromJob ? groundedOn : 0, toolResults, webHits };
  }
  if (!isAskModelConfigured(apiKey || null) && input.lookup && isRoomQuestion(input.question)) {
    const roomAnswer = answerRoomQuestion(input.question, roomClipsFromCatalog(input.lookup));
    if (roomAnswer) {
      emit(roomAnswer);
      return { ...empty, answer: roomAnswer, groundedOn, toolResults, webHits };
    }
  }

  if (!isAskModelConfigured(apiKey || null) && !(input.lookup && isLongMemoryQuestion(input.question))) {
    const toolOnly = toolResults.filter((r) => r.ok && r.tool !== 'web_search');
    if (webHits.length || webAnswer) {
      const jobAnswer = toolOnly.length && asksAboutJobFile(input.question)
        ? toolOnly.map((r) => r.summary).join(' ')
        : spoken;
      const fallback = webFallbackAnswer({
        question: input.question,
        jobAnswer,
        webAnswer,
        hits: webHits,
      });
      let answer = fallback.answer;
      const trailer = formatActionsTrailer(toolResults);
      if (trailer) answer = `${answer.trimEnd()}\n\n${trailer}`;
      emit(answer);
      return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits, webDerivedAnswer: fallback.webDerived });
    }
    if (toolOnly.length) {
      const prose =
        toolOnly.map((r) => r.summary).join(' ') +
        (toolOnly.some((r) => r.needsConfirmation)
          ? ' Confirmation required before anything irreversible happens.'
          : '');
      const trailer = formatActionsTrailer(toolResults);
      const answer = trailer ? `${prose}\n\n${trailer}` : prose;
      emit(answer);
      return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits });
    }
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: spokenFromJob ? groundedOn : 0, toolResults, webHits };
  }

  const record = formatJobFileRecord(input.file).trim();
  if (!input.lookup && !record && !toolResults.length && !webUsable) {
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: spokenFromJob ? groundedOn : 0, toolResults, webHits };
  }

  const sourceHistory = input.history ?? [];
  const modelHistory = historyWithoutPrivateUploads(sourceHistory, input.sessionDocuments);
  const privateHistoryRemoved =
    sourceHistory.some((turn) => turn.officeOnly === true) ||
    (modelHistory != null && modelHistory.length < sourceHistory.length);
  const promptMemory =
    privateHistoryRemoved && input.memory
      ? { ...input.memory, summary: '', notes: [] }
      : input.memory;
  const history = (modelHistory ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text)}`)
    .join('\n');

  const styleAddendum = stylePromptAddendum(input.styleSummary ?? '');
  const extraSystem =
    `\n\n${askClockSystemRules(input.now ?? new Date(), zone)}` +
    `\n\n${askWebCapabilityRules()}` +
    (webUsable
      ? `\n\n${ASK_WEB_FORMAT_RULES}`
      : webSearchAttempted
        ? `\n\n${ASK_WEB_EMPTY_RESULTS_NOTE}`
        : '') +
    (toolResults.length
      ? `\n\nIN-PRODUCT ACTIONS: Tool results below already ran. Summarize what changed or what you found. Never claim you emailed anyone. If a tool needs confirmation, tell the user clearly and do not pretend it already happened. Append ⟦actions: …⟧ only if tools already attached it — the server appends the trailer.`
      : '') +
    (styleAddendum ? `\n\n${styleAddendum}` : '');

  const webBlock = webUsable
    ? `\n\nWEB SEARCH RESULTS (public web — supplemental only; job evidence wins and is never overridden):\n${formatAskWebContext(webHits, webAnswer)}`
    : webSearchAttempted
      ? `\n\nWEB SEARCH RESULTS: (none — live search returned no usable hits; do not invent web findings)`
      : '';
  const toolBlock = toolResults.length
    ? `\n\nTOOL RESULTS (already executed):\n${formatAskToolResultsForModel(toolResults)}`
    : '';

  if (input.lookup) {
    // Clips already live in the lookup catalog. Pass every other job-file
    // section so Chat answers like someone who knows the whole file.
    const jobFileRecord = formatJobFileRecord({ ...input.file, clips: [] }).trim();
    const looked = await answerFromAskLookup({
      orgMemory: input.orgMemory ?? null,
      question: input.question,
      catalog: input.lookup,
      history: modelHistory,
      memory: promptMemory,
      jobFileRecord,
      extra: [trim(input.file.mentionSupplement), webBlock, toolBlock, extraSystem].filter(Boolean).join('\n'),
      anthropicApiKey: apiKey || null,
      fetchFn: input.fetchFn,
      onToken: emit,
      onStatus: input.onStatus,
      signal: input.signal,
      timing: input.timing,
      // This turn already searched (or chose not to): no second web round.
      webSearchDone: webSearchAttempted || toolResults.some((r) => r.tool === 'web_search'),
      onPreviewReset: input.onPreviewReset,
      setPreviewCheck: input.setPreviewCheck,
    });
    for (const step of looked.trace) {
      if (step.tool !== 'web_search' || !step.result.data || typeof step.result.data !== 'object') continue;
      const data = step.result.data as { answer?: string; results?: AskWebHit[] };
      if (data.answer && !webAnswer) webAnswer = data.answer;
      for (const hit of data.results ?? []) {
        if (hit?.url && !webHits.some((row) => row.url === hit.url)) webHits.push(hit);
      }
    }
    let answer = trimChatFiller(normalizeAskProse(looked.answer), { question: input.question });
    // Final check before render: every quote is a retrieved transcript line or an uploaded document.
    const documentChunks = documentChunksForGrounding(documentViews(input.file));
    answer = enforceQuoteGrounding(answer, {
      chunks: [...looked.retrievedChunks, ...documentChunks],
      question: input.question,
    }).answer;
    const applied = await applyWebResults(answer, input.question, webHits, webAnswer, {
      apiKey: apiKey || null,
      fetchFn: input.fetchFn,
      now: input.now,
      timeZone: zone,
    });
    answer = applied.answer;
    const actions = formatActionsTrailer(toolResults);
    if (actions && !/⟦actions:/i.test(answer)) {
      answer = `${answer.trimEnd()}\n\n${actions}`;
    }
    return {
      answer,
      model: looked.model,
      // A reply built on web results that cites nothing from this job is not
      // "From this job file".
      groundedOn: webBackedWithoutJobCite(answer, webHits, webAnswer, applied.webDerived) ? 0 : groundedOn,
      usage: applied.usage ? mergeMeasuredUsages([looked.usage, applied.usage], looked.model) : looked.usage,
      webHits,
      toolResults,
      answeredFromLookup: true,
      webDerivedAnswer: applied.webDerived,
      research: looked.research ?? null,
      ...(answerQuotesPrivateUpload(answer, input.sessionDocuments) ? { officeOnly: true } : {}),
    };
  }

  const mentionPrompt = mentionScoped
    ? assembleMentionModelPrompt({
        question: input.question,
        file: input.file,
        history: modelHistory,
        webBlock,
        toolBlock,
        extraSystem,
      })
    : null;
  const system = mentionPrompt ? mentionPrompt.system : FILE_QA_SYSTEM + extraSystem;
  const user = mentionPrompt
    ? mentionPrompt.user
    : `Job file record:\n\n${record || '(empty record)'}` +
      webBlock +
      toolBlock +
      (history ? `\n\nEarlier questions on this file:\n${history}` : '') +
      `\n\nQuestion: ${input.question}`;

  const completed = await completeAskText({
    system,
    user,
    anthropicApiKey: apiKey || null,
    mode: 'interactive',
    onToken: emit,
    fetchFn: input.fetchFn,
  });
  if (!completed) {
    if (webUsable) {
      const toolOnly = toolResults.filter((r) => r.ok && r.tool !== 'web_search');
      const jobAnswer = asksAboutJobFile(input.question)
        ? toolOnly.length
          ? toolOnly.map((r) => r.summary).join(' ')
          : spoken
        : '';
      const fallback = webFallbackAnswer({
        question: input.question,
        jobAnswer,
        webAnswer,
        hits: webHits,
      });
      let answer = fallback.answer;
      const trailer = formatActionsTrailer(toolResults);
      if (trailer) answer = `${answer.trimEnd()}\n\n${trailer}`;
      emit(answer);
      return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits, webDerivedAnswer: fallback.webDerived });
    }
    const toolOnly = toolResults.filter((r) => r.ok);
    const prose = toolOnly.length ? toolOnly.map((r) => r.summary).join(' ') : spoken;
    const trailer = formatActionsTrailer(toolResults);
    const answer = trailer ? `${prose}\n\n${trailer}` : prose;
    emit(answer);
    return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits });
  }
  let answer = trimChatFiller(normalizeAskProse(completed.text), { question: input.question });
  const applied = await applyWebResults(answer, input.question, webHits, webAnswer, {
    apiKey: apiKey || null,
    fetchFn: input.fetchFn,
    now: input.now,
    timeZone: zone,
  });
  answer = applied.answer;
  const actions = formatActionsTrailer(toolResults);
  if (actions && !/⟦actions:/i.test(answer)) {
    answer = `${answer.trimEnd()}\n\n${actions}`;
  }
  return {
    answer,
    model: completed.model,
    groundedOn: webBackedWithoutJobCite(answer, webHits, webAnswer, applied.webDerived) ? 0 : groundedOn,
    usage: applied.usage ? mergeMeasuredUsages([completed.usage, applied.usage], completed.model) : completed.usage,
    webHits,
    toolResults,
    webDerivedAnswer: applied.webDerived,
    ...(answerQuotesPrivateUpload(answer, input.sessionDocuments) ? { officeOnly: true } : {}),
  };
}
