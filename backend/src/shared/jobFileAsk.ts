/**
 * Ask the whole job file — not only the videos.
 *
 * The office page is one file: brief facts (any keys), scope including
 * do-nots, notes, invited companies, tasks, crew, work logs, memory, uploaded
 * documents, and clip readings. A question like "what's the lockbox" or
 * "who is invited" is answerable from that record even when nothing has been
 * filmed. When a model key is wired (server ANTHROPIC_API_KEY or the org's
 * connected key) it writes the prose; otherwise a grounded lookup still
 * answers from the same text.
 */
import { anthropicClientForKey } from '../lib/anthropic.js';
import { config } from '../config.js';
import {
  formatCollectionRecord,
  groundedCollectionAnswer,
  type CollectionClip,
} from './proofAnalyst.js';

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
}

const FILE_QA_SYSTEM = `You answer questions about one job file, using only the record provided.

The record may contain any mix of: job identity, brief facts (any labels), scope lines including do-nots, notes and messages, invited companies, tasks, crew, work logs, memory events, uploaded documents, and video readings / mic transcripts. Treat every section as first-class evidence. A job with no video is still answerable from the rest of the file.

Rules:
1. Answer only from the record given. Do not invent facts, prices, or coverage decisions.
2. If the record does not contain the answer, say "This job file does not have that" and stop. Do not reason about what was probably true.
3. Quote which part of the file you used (brief field, scope line, note, clip date, task, log) so the answer can be checked.
4. Two or three sentences. This is read next to the file.
5. Never estimate cost, hours, or whether work was worth paying for unless those numbers are already written on the file.
6. Speech on a recording and written notes are both evidence. Quote them when that is what was asked.`;

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

  const clips = file.clips ?? [];
  if (clips.length) {
    sections.push(`Videos and mic\n${formatCollectionRecord(clips)}`);
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

export async function answerFromJobFile(input: {
  question: string;
  file: JobFileAskContext;
  history?: JobFileAskTurn[];
  apiKey?: string | null;
}): Promise<{ answer: string; model: string | null; groundedOn: number }> {
  const grounded = groundedJobFileAnswer(input.question, input.file);
  const groundedOn = countJobFileSources(input.file);
  const apiKey = (input.apiKey === undefined ? config.anthropic.apiKey : input.apiKey ?? '').trim();
  const canCallModel = Boolean(apiKey);

  if (!jobFileHasContent(input.file)) {
    return { answer: grounded, model: null, groundedOn: 0 };
  }
  if (!canCallModel) {
    return { answer: grounded, model: null, groundedOn };
  }

  const record = formatJobFileRecord(input.file).trim();
  if (!record) return { answer: grounded, model: null, groundedOn };

  const history = (input.history ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text)}`)
    .join('\n');

  try {
    const client = anthropicClientForKey(apiKey || config.anthropic.apiKey);
    const response = await client.messages.create({
      model: config.technician.assistant.model,
      max_tokens: 500,
      system: FILE_QA_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Job file record:\n\n${record}` +
            (history ? `\n\nEarlier questions on this file:\n${history}` : '') +
            `\n\nQuestion: ${input.question}`,
        },
      ],
    });
    const answer = response.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text?: string }) => block.text ?? '')
      .join('\n')
      .trim();
    return answer
      ? { answer, model: response.model, groundedOn }
      : { answer: grounded, model: null, groundedOn };
  } catch {
    return { answer: grounded, model: null, groundedOn };
  }
}
