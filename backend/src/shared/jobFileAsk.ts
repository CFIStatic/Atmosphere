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
import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import type { AskTurnClock } from './askTiming.js';
import { answerFromAskLookup } from './askReasoning.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import { isLongMemoryQuestion, type LongThreadMemory } from './askMemory.js';
import type { AskLookupCatalog } from './askLookup.js';
import { activitySystemAddendum } from './mentions.js';
import { ASK_PROSE_FORMAT_RULES, normalizeAskProse } from './askProse.js';
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
  ensureWebResultsSection,
  formatAskWebContext,
  includeDomainsForAsk,
  looksLikePureWebCapabilityAsk,
  professionalWebCapabilityAnswer,
  restrictAskMarkdownLinks,
  searchAskWebDetailed,
  shouldSupplementWithWebSearch,
  asksAboutJobFile,
  looksLikeExplicitWebSearchRequest,
  looksLikeOutsideKnowledgeAsk,
  type AskWebHit,
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
  filename?: string | null;
  extractedText?: string | null;
}

export interface JobFileAskTurn {
  role: 'user' | 'assistant';
  text: string;
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

const FILE_QA_SYSTEM = `You are a sharp, friendly expert on this job file. Answer like a top-tier chat assistant: natural, clear, easy to scan — never a forensic dump or a thin keyword match.

The record may contain any mix of: job identity, brief facts (any labels), scope lines including do-nots, notes and messages, invited companies, tasks, crew, work logs, memory events, uploaded documents, and video readings / mic transcripts. Treat every section as first-class evidence. A job with no video is still answerable from the rest of the file.

Rules:
1. Answer questions about this job, its videos, people, findings, or records only from the record given. Do not invent job facts, prices, or coverage decisions. Web search never replaces or overrides that evidence.
2. If the record does not contain a job-specific answer and no WEB SEARCH RESULTS apply, say "This job file does not have that" and stop. When the question is not about this job and WEB SEARCH RESULTS are provided, answer from those results for any public topic. Never invent what happened on this job from the web, and never quote web text as a speaker.
3. LAYERED DEFAULT for broad asks: short natural opener, a few markdown bullets with **Label:** when listing, optional invite to go deeper. Do not dump every quote or document excerpt on the first pass.
4. GO DEEP when they ask for specifics (exact quotes, who said X, timestamps, "be specific", "more detail", full transcript): quote exactly and ground on the file (brief field, scope line, note, clip date, task, log, seek time).
5. Cite job-file sources via ⟦sources: …⟧. Cite the web only in a **Web results** section of markdown links, kept separate from job evidence — never "(Source: …)" parentheticals or raw URL dumps in the job sentences.
6. Never estimate cost, hours, or whether work was worth paying for unless those numbers are already written on the file.
7. Speech on a recording and written notes are both evidence. For conversation topics, summarize first; only paste verbatim lines when depth was requested — never answer talk questions from vision-only room/screen descriptions.
8. Tone: warm expert colleague, lightly structured, no stiff disclaimers.
9. The raw mic transcript is authoritative for what was said and how much. An AI summary or conversation brief may be stale; when it disagrees with the transcript, follow the transcript and do not repeat the summary's claim.
10. A "how many" question (lines, utterances, quotes, times something was said) gets the number first, counted from the raw transcript lines: "There are **5** lines in the transcript." Then list them if asked.
11. When the question assumes something the file does not show (an object, a brand, an install, a person, a visual detail), say plainly that it is not in the evidence. Do not guess or answer with a nearby detail.
12. Quotes are exact transcript words only, never paraphrased inside quotation marks, each followed by the clip name and time, like “We need the permit.” (Kitchen walkthrough, 0:15).
13. Speakers: use only diarization labels ("Speaker 1") or a name the file explicitly gives that speaker. Otherwise write "an unidentified speaker" and append nothing. Never infer a name, role, posture, or relationship, and never write labels like "Person 1 (Seated…)" as a speaker.

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
    const text = trim(doc.extractedText);
    if (!text) continue;
    push(doc.filename ? `document · ${doc.filename}` : 'document', text.slice(0, 4000));
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
  if ((file.documents ?? []).some((doc) => trim(doc.extractedText))) n += 1;
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

  const docs = (file.documents ?? []).filter((doc) => trim(doc.extractedText));
  if (docs.length) {
    sections.push(
      `Uploaded documents\n${docs
        .map((doc) => `- ${trim(doc.filename) || 'document'}: ${trim(doc.extractedText).slice(0, 2500)}`)
        .join('\n')}`,
    );
  }

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

/**
 * Deterministic answer from whatever is already on the file. Used when no
 * model key is wired, and as a fallback if the model call fails.
 */
export function groundedJobFileAnswer(question: string, file: JobFileAskContext): string {
  const rows = jobFileCorpus(file);
  if (!rows.length) {
    return 'Nothing is on this job file yet, so there is nothing to answer from.';
  }

  if (looksLikeOverview(question)) return overviewFromFile(file);

  const words = tokens(question);
  if (!words.length) return overviewFromFile(file);

  const need = words.some((word) => word.length >= 6) ? 1 : Math.min(words.length >= 2 ? 2 : 1, words.length);
  const scored = rows
    .map((row) => {
      const hay = tokens(row.text);
      const hits = words.filter((token) => hay.some((h) => tokensOverlap(token, h) || h === token));
      return { row, score: hits.length };
    })
    .filter((entry) => entry.score >= need)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    // Clip-only keyword path still helps "what did the videos show" wording.
    if ((file.clips ?? []).length && /video|clip|film|footage|mic|said/i.test(question)) {
      return groundedCollectionAnswer(question, file.clips ?? []);
    }
    return 'This job file does not have that.';
  }

  const top = scored.slice(0, 2);
  return top
    .map(({ row }) => `${row.source}: ${row.text}`.replace(/\s+/g, ' ').trim())
    .join(' ')
    .slice(0, 700);
}

/**
 * Prefer the grounded file hit when it is already a clear brief/field answer
 * or a simple overview — skip the model for near-instant Ask.
 */
export function preferJobFileGroundedFastPath(question: string, grounded: string): boolean {
  if (/does not have that|Nothing is on this job file/i.test(grounded)) return false;
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

function applyWebResults(answer: string, question: string, hits: AskWebHit[], webAnswer: string): string {
  const restricted = restrictAskMarkdownLinks(answer, hits.map((hit) => hit.url));
  if (!hits.length && !trim(webAnswer)) return restricted;
  const refused =
    /does not have that|not on (this )?file|cannot search|can't search|unable to search|do not have (web|internet) access|aren'?t connected/i.test(
      answer,
    );
  if (!asksAboutJobFile(question) && refused) {
    return composeAskWebAnswer({ question, jobAnswer: '', webAnswer, hits });
  }
  return ensureWebResultsSection(restricted, hits);
}

export async function answerFromJobFile(input: {
  question: string;
  file: JobFileAskContext;
  history?: JobFileAskTurn[];
  /** Summary of older turns and durable notes. Recent history stays verbatim. */
  memory?: LongThreadMemory | null;
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
}): Promise<{
  answer: string;
  model: string | null;
  groundedOn: number;
  usage: MeasuredUsage | null;
  webHits: AskWebHit[];
  toolResults: AskToolResult[];
  /** True when the reply came from the lookup tools, including a failed-model grounding. */
  answeredFromLookup?: boolean;
}> {
  const emit = (text: string) => {
    if (text) input.timing?.markFirstToken();
    input.onToken?.(text);
  };
  const grounded = groundedJobFileAnswer(input.question, input.file);
  const groundedOn = countJobFileSources(input.file);
  const apiKey = (input.apiKey ?? '').trim();
  const empty = {
    answer: grounded,
    model: null as string | null,
    groundedOn: 0,
    usage: null as MeasuredUsage | null,
    webHits: [] as AskWebHit[],
    toolResults: [] as AskToolResult[],
  };

  // Capability-only ("can you search Google?") → short professional yes, no live
  // search, no model star soup / google.com junk citations.
  if (looksLikePureWebCapabilityAsk(input.question)) {
    const answer = professionalWebCapabilityAnswer(input.question);
    emit(answer);
    return { ...empty, answer, groundedOn, toolResults: [], webHits: [] };
  }

  // Run safe tools first so field updates apply before the model writes prose.
  let toolResults: AskToolResult[] = [];
  let webHits: AskWebHit[] = [];
  if (input.toolContext) {
    const picks = pickAskToolsHeuristically(input.question, input.toolContext.access);
    const { sequential, parallel } = partitionAskTools(picks);
    const runTool = async (name: (typeof picks)[number]) => {
      const rawInput =
        name === 'web_search'
          ? { query: input.question, include_domains: includeDomainsForAsk(input.question) }
          : name === 'find_evidence_moments'
            ? { topic: input.question }
            : name === 'search_crm'
              ? { query: input.question }
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
      });
      input.timing?.addTool(name, performance.now() - started);
      return result;
    };
    for (const name of sequential) toolResults.push(await runTool(name));
    if (parallel.length) toolResults.push(...(await Promise.all(parallel.map((name) => runTool(name)))));
    webHits = collectWebHitsFromToolResults(toolResults);
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
    emit(grounded);
    return { ...empty, answer: grounded, groundedOn: 0, toolResults };
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
  if (!mentionScoped && !webHits.length && !webAnswer.trim() && shouldSupplementWithWebSearch(input.question, grounded)) {
    webSearchAttempted = true;
    const outcome = await searchAskWebDetailed(input.question, {
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
    emit(grounded);
    return { ...empty, answer: grounded, groundedOn, toolResults, webHits };
  }
  if (!isAskModelConfigured(apiKey || null) && !(input.lookup && isLongMemoryQuestion(input.question))) {
    const toolOnly = toolResults.filter((r) => r.ok && r.tool !== 'web_search');
    if (webHits.length || webAnswer) {
      const jobAnswer = toolOnly.length && asksAboutJobFile(input.question)
        ? toolOnly.map((r) => r.summary).join(' ')
        : grounded;
      let answer = composeAskWebAnswer({
        question: input.question,
        jobAnswer,
        webAnswer,
        hits: webHits,
      });
      const trailer = formatActionsTrailer(toolResults);
      if (trailer) answer = `${answer.trimEnd()}\n\n${trailer}`;
      emit(answer);
      return { ...empty, answer, groundedOn, toolResults, webHits };
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
      return { ...empty, answer, groundedOn, toolResults, webHits };
    }
    emit(grounded);
    return { ...empty, answer: grounded, groundedOn, toolResults, webHits };
  }

  const record = formatJobFileRecord(input.file).trim();
  if (!input.lookup && !record && !toolResults.length && !webUsable) {
    emit(grounded);
    return { ...empty, answer: grounded, groundedOn, toolResults, webHits };
  }

  const history = (input.history ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text)}`)
    .join('\n');

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
      : '');

  const webBlock = webUsable
    ? `\n\nWEB SEARCH RESULTS (public web — supplemental only; job evidence wins and is never overridden):\n${formatAskWebContext(webHits, webAnswer)}`
    : webSearchAttempted
      ? `\n\nWEB SEARCH RESULTS: (none — live search returned no usable hits; do not invent web findings)`
      : '';
  const toolBlock = toolResults.length
    ? `\n\nTOOL RESULTS (already executed):\n${formatAskToolResultsForModel(toolResults)}`
    : '';

  if (input.lookup) {
    const looked = await answerFromAskLookup({
      question: input.question,
      catalog: input.lookup,
      history: input.history,
      memory: input.memory,
      extra: [trim(input.file.mentionSupplement), webBlock, toolBlock, extraSystem].filter(Boolean).join('\n'),
      anthropicApiKey: apiKey || null,
      fetchFn: input.fetchFn,
      onToken: emit,
      onStatus: input.onStatus,
      signal: input.signal,
      timing: input.timing,
    });
    for (const step of looked.trace) {
      if (step.tool !== 'web_search' || !step.result.data || typeof step.result.data !== 'object') continue;
      const data = step.result.data as { answer?: string; results?: AskWebHit[] };
      if (data.answer && !webAnswer) webAnswer = data.answer;
      for (const hit of data.results ?? []) {
        if (hit?.url && !webHits.some((row) => row.url === hit.url)) webHits.push(hit);
      }
    }
    let answer = normalizeAskProse(looked.answer);
    // Final check before render: every quote is a retrieved transcript line.
    answer = enforceQuoteGrounding(answer, { chunks: looked.retrievedChunks, question: input.question }).answer;
    answer = applyWebResults(answer, input.question, webHits, webAnswer);
    const actions = formatActionsTrailer(toolResults);
    if (actions && !/⟦actions:/i.test(answer)) {
      answer = `${answer.trimEnd()}\n\n${actions}`;
    }
    return {
      answer,
      model: looked.model,
      groundedOn,
      usage: looked.usage,
      webHits,
      toolResults,
      answeredFromLookup: true,
    };
  }

  const mentionPrompt = mentionScoped
    ? assembleMentionModelPrompt({
        question: input.question,
        file: input.file,
        history: input.history,
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
          : grounded
        : '';
      let answer = composeAskWebAnswer({
        question: input.question,
        jobAnswer,
        webAnswer,
        hits: webHits,
      });
      const trailer = formatActionsTrailer(toolResults);
      if (trailer) answer = `${answer.trimEnd()}\n\n${trailer}`;
      emit(answer);
      return { ...empty, answer, groundedOn, toolResults, webHits };
    }
    const toolOnly = toolResults.filter((r) => r.ok);
    const prose = toolOnly.length ? toolOnly.map((r) => r.summary).join(' ') : grounded;
    const trailer = formatActionsTrailer(toolResults);
    const answer = trailer ? `${prose}\n\n${trailer}` : prose;
    emit(answer);
    return { ...empty, answer, groundedOn, toolResults, webHits };
  }
  let answer = normalizeAskProse(completed.text);
  answer = applyWebResults(answer, input.question, webHits, webAnswer);
  const actions = formatActionsTrailer(toolResults);
  if (actions && !/⟦actions:/i.test(answer)) {
    answer = `${answer.trimEnd()}\n\n${actions}`;
  }
  return {
    answer,
    model: completed.model,
    groundedOn,
    usage: completed.usage,
    webHits,
    toolResults,
  };
}
