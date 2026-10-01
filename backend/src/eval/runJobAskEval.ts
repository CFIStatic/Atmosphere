/**
 * Job-level Ask gold: runs each question through the same pieces runProofAsk
 * wires (collectionClipsFromRows → file, askLookupCatalogFromJob → lookup,
 * answerFromJobFile), then scores it. Deterministic without a model key.
 *
 * Every job answer is also checked for fabricated speaker labels ("Person 1
 * (Seated", "Seated man") and unbalanced parentheses; either fails the gate.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { collectionClipsFromRows } from '../shared/proofAnalyst.js';
import { askLookupCatalogFromJob, clipFromProofRow } from '../shared/askLookup.js';
import { answerFromJobFile, type JobFileAskContext } from '../shared/jobFileAsk.js';
import { answerFromAskLookup } from '../shared/askReasoning.js';
import { enforceQuoteGrounding } from '../shared/askQuoteGrounding.js';
import { answerFromJobDocuments, documentChunksForGrounding, type AskDocumentView } from '../documents/answer.js';
import { normalizeAskProse } from '../shared/askProse.js';
import { isAskModelConfigured } from '../lib/askModel.js';
import { parseMomentSource, parseQuoteTrailer } from '../shared/askMoments.js';
import { normalizeForMatch } from '../shared/askVerify.js';
import type { ClipAskRecord } from '../shared/clipAsk.js';
import { formatAskClock } from '../shared/askMoments.js';
import { askTimed } from '../shared/askLookup.js';
import { scoreAnswer, type AnswerScore } from './scoreAsk.js';
import type { GoldJob, GoldQuestion } from './goldTypes.js';

export type JobAnswerFn = (question: string, job: GoldJob) => Promise<string>;

export type JobResult = {
  jobId: string;
  answers: Array<AnswerScore & { question: string; answer: string; speakerLabelFailures: string[] }>;
};

function stubContext(): any {
  const stub: any = new Proxy(function () {}, {
    get: (_t, key) => (key === 'then' ? undefined : stub),
    apply: () => stub,
  });
  return stub;
}

export const defaultJobAnswerFn: JobAnswerFn = async (question, job) => {
  const { fixture } = job;
  const uploaded = (fixture.documents ?? []) as AskDocumentView[];
  if (uploaded.length) {
    const direct = answerFromJobDocuments(question, uploaded, []);
    if (direct) {
      const prose = normalizeAskProse(direct);
      return enforceQuoteGrounding(prose, {
        chunks: documentChunksForGrounding(uploaded),
        question,
      }).answer;
    }
  }
  const company = new Map(fixture.parties.map((party) => [String(party.id ?? ''), party.company ?? null]));
  const clips = collectionClipsFromRows(
    fixture.proofs.map((row) => ({ ...row, company: company.get(String(row.party_id ?? '')) ?? null })) as any,
  );
  const file: JobFileAskContext = {
    job: { title: fixture.job.title },
    facts: {},
    scope: [],
    messages: [],
    parties: fixture.parties.map((party) => ({ company: String(party.company ?? '') })),
    tasks: [],
    crew: [],
    workLogs: [],
    memory: [],
    documents: [],
    clips,
  } as unknown as JobFileAskContext;
  const lookup = askLookupCatalogFromJob({
    orgId: fixture.job.org_id,
    jobId: fixture.job.id,
    access: 'org',
    proofs: fixture.proofs,
    parties: fixture.parties as any,
    history: [],
    jobTitle: fixture.job.title,
    timeZone: job.timeZone ?? 'America/Chicago',
    people: [],
    orgClips: (fixture.orgProofs ?? []).map((row) =>
      clipFromProofRow(row, {
        orgId: String(row.org_id ?? fixture.job.org_id),
        jobId: String(row.job_id ?? ''),
        jobTitle: row.job_title ? String(row.job_title) : null,
      }),
    ),
  } as any);
  if (!isAskModelConfigured()) {
    // Deterministic run: the job Ask lookup pipeline with every model call
    // failing, which is the path production takes when the model is down.
    // Same post-processing as answerFromJobFile's lookup branch.
    const looked = await answerFromAskLookup({
      question,
      catalog: lookup,
      history: [],
      memory: null,
      step: async () => null,
      repair: async () => null,
    });
    const answer = normalizeAskProse(looked.answer);
    return enforceQuoteGrounding(answer, { chunks: looked.retrievedChunks, question }).answer;
  }
  const result = await answerFromJobFile({
    question,
    file,
    history: [],
    memory: null,
    apiKey: null,
    lookup,
    toolContext: {
      orgId: fixture.job.org_id,
      jobId: fixture.job.id,
      supabase: stubContext(),
      access: 'org',
      file,
      userId: null,
      authorLabel: null,
      propertyId: null,
      address: null,
      jobTitle: fixture.job.title,
    } as any,
  } as any);
  return result.answer;
};

/** The whole job's transcript as one record, so the clip scorer can check grounding. */
export function jobEvidenceRecord(job: GoldJob): ClipAskRecord {
  const lines: string[] = [];
  for (const row of [...job.fixture.proofs, ...(job.fixture.orgProofs ?? [])]) {
    const segments = askTimed(row.transcript_segments);
    if (segments.length) {
      for (const seg of segments) lines.push(`[${formatAskClock(seg.start)}] ${seg.text}`);
    } else if (row.transcript_text) {
      lines.push(...String(row.transcript_text).split('\n'));
    }
  }
  for (const doc of job.fixture.documents ?? []) {
    const row = doc as { extractedText?: unknown; attached?: boolean | null; relevance?: string | null };
    if (row.attached === false || row.relevance === 'not_related' || row.relevance === 'pending_confirm') continue;
    const text = String(row.extractedText ?? '').trim();
    if (text) lines.push(text);
  }
  return { transcript: lines.join('\n'), analysisState: 'done', transcriptStatus: 'done' } as unknown as ClipAskRecord;
}

const TRAILERS = /⟦[^⟧]*⟧/g;

/** Fabricated speaker labels and unbalanced parentheses in an answer (prose and quote-card speakers). */
export function speakerLabelFailures(answer: string): string[] {
  const failures: string[] = [];
  const body = answer.replace(TRAILERS, ' ');
  const speakers = parseQuoteTrailer(`\n${answer.match(/⟦quotes:[^⟧]*⟧/i)?.[0] ?? ''}`).map((q) => q.speaker);
  for (const text of [body, ...speakers]) {
    if (/\bPerson\s+\d+\s*\(/.test(text)) failures.push('fabricated label “Person N (…”');
    else if (/\bPerson\s+\d+\b/.test(text)) failures.push('fabricated label “Person N”');
    if (/\b(?:seated|standing|walking)\s+(?:man|woman|person)\b/i.test(text)) failures.push('posture label as speaker');
    for (const line of text.split('\n')) {
      const open = (line.match(/\(/g) ?? []).length;
      const close = (line.match(/\)/g) ?? []).length;
      if (open !== close) {
        failures.push('unbalanced parenthesis');
        break;
      }
    }
  }
  return [...new Set(failures)];
}

function quoteCardMisses(question: GoldQuestion, answer: string): string[] {
  const expect = question.expect;
  if (!expect.quoteCards) return [];
  const misses: string[] = [];
  const cards = parseQuoteTrailer(`\n${answer.match(/⟦quotes:[^⟧]*⟧/i)?.[0] ?? ''}`);
  for (const quote of expect.quotes ?? []) {
    const card = cards.find((c) => normalizeForMatch(c.text).includes(normalizeForMatch(quote.text)));
    if (!card) {
      misses.push(`no quote card for “${quote.text}”`);
      continue;
    }
    const at = parseMomentSource(card.sourceId)?.atSeconds;
    if (quote.at != null && (at == null || Math.abs(at - Number(quote.at)) > 1)) {
      misses.push(`quote card link for “${quote.text}” is not at ${quote.at}s`);
    }
    if (expect.clipTitle && !String(card.clipTitle ?? '').includes(expect.clipTitle)) {
      misses.push(`quote card for “${quote.text}” lacks the clip name`);
    }
  }
  if (expect.clipTitle) {
    const body = answer.replace(TRAILERS, ' ');
    for (const quote of expect.quotes ?? []) {
      const line = body.split('\n').find((row) => normalizeForMatch(row).includes(normalizeForMatch(quote.text)));
      if (line && !line.includes(expect.clipTitle)) misses.push(`quoted line “${quote.text}” lacks the clip name`);
    }
  }
  return misses;
}

export async function runJob(job: GoldJob, answer: JobAnswerFn = defaultJobAnswerFn): Promise<JobResult> {
  const record = jobEvidenceRecord(job);
  const answers: JobResult['answers'] = [];
  for (const question of job.questions) {
    const text = await answer(question.question, job);
    const body = text.replace(TRAILERS, ' ').replace(/[ \t]+\n/g, '\n').trim();
    const score = scoreAnswer(question, body, record);
    const cardMisses = quoteCardMisses(question, text);
    const labels = speakerLabelFailures(text);
    const misses = [...score.misses, ...cardMisses, ...labels.map((l) => `speaker label: ${l}`)];
    answers.push({
      ...score,
      misses,
      correct: misses.length === 0,
      question: question.question,
      answer: text,
      speakerLabelFailures: labels,
    });
  }
  return { jobId: job.id, answers };
}
