/**
 * Score one Ask answer against its gold expectation. Pure, so it runs the same
 * in CI (synthetic gold) and against the private real-clip gold.
 */
import type { ClipAskRecord } from '../shared/clipAsk.js';
import { answerQualityFailures, normalizeForMatch, type AskVerifyFailure } from '../shared/askVerify.js';
import { speechCountContradictions, transcriptLineCount, transcriptLines } from '../shared/speechCount.js';
import type { GoldQuestion } from './goldTypes.js';

export const ABSTAIN_RE =
  /\b(not shown|not established|does not show|doesn't show|not visible|isn't visible|never mentions?|no one mentions|nothing (?:in|on) (?:this|the)|not by anyone on site|can't (?:tell|see|give)|cannot (?:tell|see)|no (?:brand|price|time) is (?:visible|mentioned)|not on file|no speech was transcribed|does not include usable speech|no one is heard|not found|wasn't found|was not found|no transcript\b[^.]{0,60}\bmentions)\b/i;

export type AnswerScore = {
  questionId: string;
  type: GoldQuestion['type'];
  correct: boolean;
  /** Why it is not correct (empty when correct). */
  misses: string[];
  relevant: boolean;
  /** Share of quoted spans in the answer that exist verbatim in the evidence (1 when nothing is quoted). */
  grounding: number;
  /** Share of expected quote times the answer states within ±1s; null when the gold has no times. */
  timestampAccuracy: number | null;
  /** Price / work-completed / commitment claims the evidence does not support, plus gold `critical` hits. */
  unsupportedClaims: string[];
  criticalAssertions: string[];
  abstained: boolean;
  abstentionCorrect: boolean;
  /** The answer states an amount of speech the transcript contradicts. */
  contradiction: boolean;
  failures: AskVerifyFailure[];
};

function clockSeconds(value: string): number | null {
  const parts = value.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function answerTimes(answer: string): number[] {
  return [...answer.matchAll(/\b(\d{1,2}(?::\d{2}){1,2})\b/g)]
    .map((m) => clockSeconds(m[1]!))
    .filter((n): n is number => n != null);
}

function has(haystackNorm: string, phrase: string): boolean {
  const needle = normalizeForMatch(phrase);
  return !needle || ` ${haystackNorm} `.includes(` ${needle} `);
}

export function evidenceText(record: ClipAskRecord): string {
  const rows: string[] = [
    record.transcript ?? '',
    record.dictation ?? '',
    record.summary ?? '',
    record.conversationSummary ?? '',
    ...(record.actions ?? []).map((a) => String((a as { description?: unknown }).description ?? '')),
    ...((record.timeline ?? []) as Array<{ summary?: unknown }>).map((t) => String(t.summary ?? '')),
    ...(record.dictationEntries ?? []).map((e) => String((e as { text?: unknown }).text ?? '')),
  ];
  return rows.filter(Boolean).join('\n');
}

function quotedSpans(answer: string): string[] {
  return [...answer.matchAll(/[“"]([^”"]{2,400})[”"]/g)].map((m) => m[1]!.trim());
}

export function scoreAnswer(question: GoldQuestion, answer: string, record: ClipAskRecord): AnswerScore {
  const expect = question.expect;
  const said = normalizeForMatch(answer);
  const evidence = evidenceText(record);
  const evidenceNorm = normalizeForMatch(evidence);
  const lines = transcriptLines(record.transcript);
  const failures = answerQualityFailures({
    question: question.question,
    answer,
    transcripts: [lines],
    evidenceNorm,
  });
  const misses: string[] = [];

  const abstained = ABSTAIN_RE.test(answer);
  const abstentionCorrect = expect.answerType === 'abstain' ? abstained : !abstained || (expect.quotes ?? []).every((q) => has(said, q.text));
  if (!abstentionCorrect) misses.push(expect.answerType === 'abstain' ? 'should say not shown / not established' : 'abstained on an answerable question');

  if (expect.count != null) {
    const lead = (answer.split(/(?<=[.!?])\s+|\n/)[0] ?? '').replace(/\*/g, '');
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    const ok = new RegExp(`\\b(${expect.count}|${words[expect.count] ?? '__'})\\b`, 'i').test(lead);
    if (!ok) misses.push(`count ${expect.count} not stated first`);
  }
  for (const quote of expect.quotes ?? []) {
    if (!has(said, quote.text)) misses.push(`missing quote “${quote.text}”`);
  }
  if (expect.yesNo) {
    const opening = answer.replace(/^\W+/, '').toLowerCase();
    if (!opening.startsWith(expect.yesNo)) misses.push(`should open with ${expect.yesNo}`);
  }
  for (const phrase of expect.mustContain ?? []) {
    if (!has(said, phrase)) misses.push(`missing “${phrase}”`);
  }
  for (const phrase of expect.mustNotContain ?? []) {
    if (has(said, phrase)) misses.push(`must not say “${phrase}”`);
  }
  if (expect.order?.length) {
    const at = expect.order.map((phrase) => ` ${said} `.indexOf(` ${normalizeForMatch(phrase)} `));
    if (at.some((i) => i < 0) || at.some((i, k) => k > 0 && i < at[k - 1]!)) misses.push('wrong or missing order');
  }

  const timed = (expect.quotes ?? []).filter((q) => q.at != null && Number.isFinite(Number(q.at)));
  const times = answerTimes(answer);
  const timestampAccuracy = timed.length
    ? timed.filter((q) => times.some((t) => Math.abs(t - Number(q.at)) <= 1)).length / timed.length
    : null;
  if (timestampAccuracy != null && timestampAccuracy < 1) misses.push('missing or wrong timestamp');

  // A quoted word echoed from the question ("never mentions “insurance”") is not a claim about the clip.
  const questionNorm = normalizeForMatch(question.question);
  const spans = quotedSpans(answer).filter((span) => !has(questionNorm, span));
  const grounding = spans.length ? spans.filter((span) => has(evidenceNorm, span)).length / spans.length : 1;

  const unsupportedClaims = failures.filter((f) => f.kind === 'unsupported_claim').map((f) => f.text);
  const criticalAssertions = [
    ...unsupportedClaims,
    ...(expect.critical ?? []).filter((phrase) => has(said, phrase)).map((phrase) => `gold critical: ${phrase}`),
  ];
  const relevant = !failures.some((f) => f.kind === 'irrelevant' || f.kind === 'transcript_dump');
  const contradiction = speechCountContradictions(answer, [transcriptLineCount(record.transcript)]).length > 0;
  if (contradiction) misses.push('states a speech count the transcript contradicts');
  if (criticalAssertions.length) misses.push(`critical assertion: ${criticalAssertions.join('; ')}`);

  return {
    questionId: question.id,
    type: question.type,
    correct: misses.length === 0,
    misses,
    relevant,
    grounding,
    timestampAccuracy,
    unsupportedClaims,
    criticalAssertions,
    abstained,
    abstentionCorrect,
    contradiction,
    failures,
  };
}
