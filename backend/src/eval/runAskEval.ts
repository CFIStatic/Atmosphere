/**
 * Run the gold set through clip Ask (and the summary publish path) and gate a
 * release: zero false work-completed / price / commitment assertions and zero
 * summary-transcript contradictions. Deterministic without a model key; uses
 * the configured model when one is set.
 */
import { answerFromClip, withAuthoritativeTranscript, type ClipAskRecord } from '../shared/clipAsk.js';
import { summaryClaimContradictions } from '../audio/summaryValidation.js';
import { publishableConversation } from '../audio/proofConversation.js';
import { scoreAnswer, type AnswerScore } from './scoreAsk.js';
import type { GoldClip, GoldSet } from './goldTypes.js';
import { runJob, type JobAnswerFn, type JobResult } from './runJobAskEval.js';

export type AnswerFn = (question: string, record: ClipAskRecord) => Promise<string>;

export type ClipResult = {
  clipId: string;
  categories: string[];
  /** Contradictions in the summary as Ask/the player would show it (after stale/contradicting summaries are dropped). */
  shownSummaryContradictions: string[];
  /** Contradictions left in a freshly generated summary after validate → regenerate → quarantine. */
  publishedSummaryContradictions: string[];
  summaryQuarantined: boolean;
  answers: Array<AnswerScore & { question: string; answer: string }>;
};

export type EvalMetrics = {
  questions: number;
  correctness: number;
  relevance: number;
  grounding: number;
  timestampAccuracy: number | null;
  unsupportedClaimRate: number;
  abstentionQuality: number | null;
  contradictionRate: number;
  criticalAssertions: number;
  summaryContradictions: number;
  /** Job Ask answers with a fabricated speaker label or an unbalanced parenthesis (gate: 0). */
  speakerLabelFailures: number;
  /** Answers that passed the scorer. Printed with the question total so a percent is not the only figure. */
  correct: number;
};

export type EvalReport = {
  gold: string;
  model: string | null;
  metrics: EvalMetrics;
  byType: Record<string, { questions: number; correct: number; correctness: number }>;
  gate: { pass: boolean; reasons: string[] };
  clips: ClipResult[];
  jobs: JobResult[];
  /** Keyless runs disable live web search so the score does not depend on DuckDuckGo. */
  webSearch: 'disabled' | 'live';
};

export const defaultAnswerFn: AnswerFn = async (question, record) => (await answerFromClip({ question, record })).answer;

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function shownSummary(record: ClipAskRecord) {
  const shown = withAuthoritativeTranscript(record);
  if (shown.conversationStale) return null;
  return {
    summary: shown.conversationSummary ?? null,
    executiveSummary: (shown as { conversationExecutiveSummary?: string | null }).conversationExecutiveSummary ?? null,
    details: shown.conversationDetails ?? [],
    concerns: shown.conversationConcerns ?? [],
  };
}

export async function runClip(clip: GoldClip, answer: AnswerFn, opts?: { summaries?: boolean }): Promise<ClipResult> {
  const record = clip.record;
  const shownSummaryContradictions = summaryClaimContradictions(shownSummary(record), record.transcript);
  let publishedSummaryContradictions: string[] = [];
  let summaryQuarantined = false;
  if (opts?.summaries !== false && record.transcript) {
    const published = await publishableConversation(record.transcript, {
      durationSeconds: record.durationSeconds ?? null,
      visionContext: record.dictation ?? null,
    });
    summaryQuarantined = published.quarantined;
    publishedSummaryContradictions = summaryClaimContradictions(published.details, record.transcript);
  }
  const answers: ClipResult['answers'] = [];
  for (const question of clip.questions) {
    const text = await answer(question.question, record);
    answers.push({ ...scoreAnswer(question, text, record), question: question.question, answer: text });
  }
  return {
    clipId: clip.id,
    categories: clip.categories,
    shownSummaryContradictions,
    publishedSummaryContradictions,
    summaryQuarantined,
    answers,
  };
}

export function summarize(gold: GoldSet, clips: ClipResult[], model: string | null, jobs: JobResult[] = []): Omit<EvalReport, 'webSearch'> {
  const all = [...clips.flatMap((clip) => clip.answers), ...jobs.flatMap((job) => job.answers)];
  const speakerLabelFailures = jobs.reduce((n, job) => n + job.answers.filter((a) => a.speakerLabelFailures.length).length, 0);
  const jobMisses = jobs.reduce((n, job) => n + job.answers.filter((a) => !a.correct).length, 0);
  const timed = all.map((a) => a.timestampAccuracy).filter((n): n is number => n != null);
  const abstainQs = all.filter((a) => {
    const q = [...gold.clips.flatMap((c) => c.questions), ...(gold.jobs ?? []).flatMap((j) => j.questions)].find((x) => x.id === a.questionId);
    return q?.expect.answerType === 'abstain';
  });
  const criticalAssertions = all.reduce((n, a) => n + a.criticalAssertions.length, 0);
  const summaryContradictions = clips.reduce(
    (n, c) => n + c.shownSummaryContradictions.length + c.publishedSummaryContradictions.length,
    0,
  );
  const metrics: EvalMetrics = {
    questions: all.length,
    correct: all.filter((a) => a.correct).length,
    correctness: mean(all.map((a) => (a.correct ? 1 : 0))),
    relevance: mean(all.map((a) => (a.relevant ? 1 : 0))),
    grounding: mean(all.map((a) => a.grounding)),
    timestampAccuracy: timed.length ? mean(timed) : null,
    unsupportedClaimRate: mean(all.map((a) => (a.unsupportedClaims.length ? 1 : 0))),
    abstentionQuality: abstainQs.length || all.length ? mean(all.map((a) => (a.abstentionCorrect ? 1 : 0))) : null,
    contradictionRate: mean(all.map((a) => (a.contradiction ? 1 : 0))),
    criticalAssertions,
    summaryContradictions,
    speakerLabelFailures,
  };
  const byType: EvalReport['byType'] = {};
  for (const a of all) {
    const row = (byType[a.type] ??= { questions: 0, correct: 0, correctness: 0 });
    row.questions += 1;
    row.correct += a.correct ? 1 : 0;
  }
  for (const row of Object.values(byType)) row.correctness = row.questions ? row.correct / row.questions : 0;
  const reasons: string[] = [];
  if (criticalAssertions > 0) reasons.push(`${criticalAssertions} false work-completed / price / commitment assertion(s)`);
  if (summaryContradictions > 0) reasons.push(`${summaryContradictions} summary-transcript contradiction(s)`);
  const answerContradictions = all.filter((a) => a.contradiction).length;
  if (answerContradictions > 0) reasons.push(`${answerContradictions} answer(s) contradict the transcript line count`);
  if (speakerLabelFailures > 0) reasons.push(`${speakerLabelFailures} job answer(s) with a fabricated speaker label or unbalanced parenthesis`);
  // Job-level regression cases (topic retrieval, exact quotes with clip + time, not-found) gate on every miss.
  if (jobMisses > 0) reasons.push(`${jobMisses} job-level Ask regression case(s) failed`);
  const floor = Number(process.env.EVAL_MIN_CORRECTNESS ?? '');
  if (Number.isFinite(floor) && floor > 0 && metrics.correctness < floor) {
    reasons.push(`correctness ${metrics.correctness.toFixed(3)} below EVAL_MIN_CORRECTNESS ${floor}`);
  }
  return { gold: gold.name, model, metrics, byType, gate: { pass: reasons.length === 0, reasons }, clips, jobs };
}

export async function runAskEval(
  gold: GoldSet,
  opts?: { answer?: AnswerFn; jobAnswer?: JobAnswerFn; model?: string | null; summaries?: boolean },
): Promise<EvalReport> {
  const liveWeb = process.env.EVAL_WITH_MODEL === '1';
  const previousWeb = process.env.ASK_WEB_SEARCH_PROVIDER;
  if (!liveWeb) process.env.ASK_WEB_SEARCH_PROVIDER = 'off';
  try {
    const answer = opts?.answer ?? defaultAnswerFn;
    const clips: ClipResult[] = [];
    for (const clip of gold.clips) {
      if (clip.consent?.status === 'declined') continue;
      clips.push(await runClip(clip, answer, { summaries: opts?.summaries }));
    }
    const jobs: JobResult[] = [];
    for (const job of gold.jobs ?? []) {
      if (job.consent?.status === 'declined') continue;
      jobs.push(await runJob(job, opts?.jobAnswer));
    }
    return { ...summarize(gold, clips, opts?.model ?? null, jobs), webSearch: liveWeb ? 'live' : 'disabled' };
  } finally {
    if (!liveWeb) {
      if (previousWeb === undefined) delete process.env.ASK_WEB_SEARCH_PROVIDER;
      else process.env.ASK_WEB_SEARCH_PROVIDER = previousWeb;
    }
  }
}

/** Drop quoted clip text from a miss so private gold never lands in a public CI log. */
function redactMiss(miss: string): string {
  return miss.replace(/“[^”]*”/g, '“…”').replace(/critical assertion: .*/, 'critical assertion');
}

export function reportMarkdown(report: EvalReport, opts?: { redact?: boolean }): string {
  const m = report.metrics;
  const pct = (n: number | null) => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`);
  const web =
    report.webSearch === 'live' ? 'live' : report.webSearch === 'disabled' ? 'disabled (no live results)' : 'unspecified';
  const lines = [
    `# Ask gold eval: ${report.gold}`,
    '',
    `Model: ${report.model ?? 'none (deterministic path)'}`,
    `Web search: ${web}`,
    `Gate: **${report.gate.pass ? 'PASS' : 'FAIL'}**${report.gate.reasons.length ? ` (${report.gate.reasons.join('; ')})` : ''}`,
    '',
    '| metric | value |',
    '| --- | --- |',
    `| questions | ${m.questions} |`,
    `| correctness | ${m.correct}/${m.questions} (${pct(m.correctness)}) |`,
    `| relevance | ${pct(m.relevance)} |`,
    `| grounding | ${pct(m.grounding)} |`,
    `| timestamp accuracy | ${pct(m.timestampAccuracy)} |`,
    `| unsupported-claim rate | ${pct(m.unsupportedClaimRate)} |`,
    `| abstention quality | ${pct(m.abstentionQuality)} |`,
    `| contradiction rate | ${pct(m.contradictionRate)} |`,
    `| critical assertions (gate: 0) | ${m.criticalAssertions} |`,
    `| summary-transcript contradictions (gate: 0) | ${m.summaryContradictions} |`,
    `| job answers with fabricated speaker labels / unbalanced parens (gate: 0) | ${m.speakerLabelFailures} |`,
    '',
    '| question type | n | correctness |',
    '| --- | --- | --- |',
    ...Object.entries(report.byType).map(
      ([type, row]) => `| ${type} | ${row.questions} | ${row.correct}/${row.questions} (${pct(row.correctness)}) |`,
    ),
  ];
  const misses = report.clips.flatMap((clip) =>
    clip.answers
      .filter((a) => !a.correct)
      .map(
        (a) =>
          `- \`${opts?.redact ? clip.clipId.slice(0, 8) : clip.clipId}\` ${a.questionId} (${a.type}): ${(opts?.redact ? a.misses.map(redactMiss) : a.misses).join('; ')}`,
      ),
  );
  for (const job of report.jobs ?? []) {
    for (const a of job.answers.filter((row) => !row.correct)) {
      misses.push(
        `- job \`${opts?.redact ? job.jobId.slice(0, 8) : job.jobId}\` ${a.questionId} (${a.type}): ${(opts?.redact ? a.misses.map(redactMiss) : a.misses).join('; ')}`,
      );
    }
  }
  if (misses.length) lines.push('', '## Misses', ...misses);
  return lines.join('\n');
}
