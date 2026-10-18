/**
 * The job file as Chat reads it: the record's shape, the text every answer is
 * drawn from, and the grounded lookups that answer without a model.
 */
import { needsCriticalEscalation } from './askRoute.js';
import { documentIsJobKnowledge } from '../documents/answer.js';
import type { DocumentFacts } from '../documents/types.js';
import { activitySystemAddendum } from './mentions.js';
import { ASK_PROSE_FORMAT_RULES } from './askProse.js';
import {
  formatCollectionRecord,
  groundedCollectionAnswer,
  type CollectionClip,
} from './proofAnalyst.js';
import {
  asksAboutJobFile,
  looksLikeExplicitWebSearchRequest,
  looksLikeOutsideKnowledgeAsk,
} from './askWebSearch.js';


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

export const FILE_QA_SYSTEM = `You are a sharp, friendly expert on this job file. Answer like Grok Bot: lead with the answer, natural and brief, easy to scan — never a forensic dump or a thin keyword match.

The record may contain any mix of: job identity, brief facts (any labels), scope lines including do-nots, notes and messages, invited companies, tasks, crew, work logs, memory events, uploaded documents, and video readings / mic transcripts. Treat every section as first-class evidence. A job with no video is still answerable from the rest of the file.

Rules:
1. Answer questions about this job, its videos, people, findings, or records only from the record given. Do not invent job facts, prices, or coverage decisions. Web search never replaces or overrides that evidence.
2. If the record does not contain a job-specific answer and no WEB SEARCH RESULTS apply, say "This job file does not have that" and stop. When the question is not about this job, answer it: from WEB SEARCH RESULTS for anything current (scores, weather, prices, news), and from general know-how for trade practice, drying and mitigation standards, codes, insurance terms, how-to steps, math, and definitions. Say plainly when a point is general guidance rather than something on the file. Never invent what happened on this job from the web, and never quote web text as a speaker.
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


export const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'did', 'does', 'do', 'is', 'was',
  'are', 'were', 'this', 'that', 'it', 'any', 'what', 'when', 'where', 'how', 'who', 'why',
  'video', 'videos', 'clip', 'film', 'day', 'job', 'file', 'tell', 'me', 'please',
]);

export type CorpusRow = { source: string; text: string };

export function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function asFacts(value: JobFileAskContext['facts']): Array<{ label: string; value: string }> {
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

export function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

export function tokensOverlap(query: string, hay: string): boolean {
  if (query === hay) return true;
  if (query.length < 5 || hay.length < 5) return false;
  return hay.includes(query) || query.includes(hay);
}

export function looksLikeOverview(question: string): boolean {
  return /what('?s| is) (on )?(this )?(job|file)|what do (you|we) know|summar(y|ise|ize)|overview|tell me about (this )?(job|file)/i.test(
    question,
  );
}

export function sentence(value: string): string {
  const text = trim(value).replace(/\s+/g, ' ');
  if (!text) return '';
  return /[.!?…:)"”]$/.test(text) ? text : `${text}.`;
}

export function plainStatus(value: unknown): string {
  return trim(value).replace(/[_-]+/g, ' ').toLowerCase();
}

/** Raw overview: compact, used by the fast-path classifier and old callers. */
export function overviewFromFile(file: JobFileAskContext): string {
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
export function readableOverview(file: JobFileAskContext): string {
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
export function readableRow(row: CorpusRow): string {
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

export const SMALL_TALK_RE =
  /^(?:\?+|hi|hey|hello|yo|thanks|thank you|thx|ty|ok|okay|k|cool|got it|great|nice|perfect|sounds good)[\s!.?]*$/i;

/** "?", "ok", "thanks", "hi": conversation, not a question the file failed to answer. */
export function isChatSmallTalk(question: string): boolean {
  return SMALL_TALK_RE.test(trim(question));
}

export function smallTalkReply(question: string): string | null {
  const q = trim(question);
  if (!SMALL_TALK_RE.test(q)) return null;
  if (/^\?+$/.test(q)) {
    return "What do you want to know? I can pull up the scope, who's on the job, what the videos show, or anything in the files.";
  }
  if (/^(thanks|thank you|thx|ty)/i.test(q)) return "You're welcome.";
  if (/^(hi|hey|hello|yo)/i.test(q)) return "Hi! What do you want to know about this job?";
  return 'Got it.';
}

export type GroundedLookup =
  | { kind: 'empty' }
  | { kind: 'overview' }
  | { kind: 'none' }
  | { kind: 'clips'; text: string }
  | { kind: 'rows'; rows: CorpusRow[] };

export function lookupJobFile(question: string, file: JobFileAskContext): GroundedLookup {
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
