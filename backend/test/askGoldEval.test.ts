import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runAskEval, reportMarkdown } from '../src/eval/runAskEval.ts';
import { scoreAnswer } from '../src/eval/scoreAsk.ts';
import type { GoldSet } from '../src/eval/goldTypes.ts';

const gold = JSON.parse(readFileSync(new URL('../eval/synthetic-gold.json', import.meta.url), 'utf8')) as GoldSet;

test('synthetic gold covers every question type and 6+ questions per clip', () => {
  const types = new Set(gold.clips.flatMap((clip) => clip.questions.map((q) => q.type)));
  for (const type of ['transcript_count', 'quote_time', 'temporal_order', 'negative', 'false_premise', 'speaker_source']) {
    assert.ok(types.has(type as never), type);
  }
  for (const clip of gold.clips) assert.ok(clip.questions.length >= 6, clip.id);
  assert.ok(gold.clips.every((clip) => clip.consent?.status === 'synthetic'));
});

test('synthetic gold mirrors the job-level regressions: owner quotes, a line count, and not found', () => {
  const jobs = gold.jobs ?? [];
  assert.ok(jobs.length >= 1);
  assert.ok(jobs.every((job) => job.consent?.status === 'synthetic'));
  const questions = jobs.flatMap((job) => job.questions);
  assert.ok(questions.some((q) => q.expect.quoteCards && (q.expect.quotes?.length ?? 0) >= 2 && q.expect.mustContain?.includes('unidentified speaker')));
  assert.ok(questions.some((q) => q.expect.answerType === 'abstain'));
  const walk = gold.clips.find((clip) => clip.id === 'syn-walkthrough-stale-summary')!;
  assert.ok(walk.questions.some((q) => q.question === 'how many spoken lines are in this clip' && q.expect.count === 5 && q.expect.quotes?.length === 5));
});

test('the gate fails when a job answer quotes the wrong lines or invents a speaker label', async () => {
  const report = await runAskEval(gold, {
    jobAnswer: async () => 'The recording on Sep 21 said:\n- Person 1 (Seated said “All her life.” (0:00)',
  });
  assert.equal(report.gate.pass, false);
  assert.ok(report.metrics.speakerLabelFailures > 0);
  assert.match(report.gate.reasons.join(' '), /job/i);
});

test('current clip Ask passes the release gate on the synthetic gold', async () => {
  const report = await runAskEval(gold);
  assert.equal(report.gate.pass, true, report.gate.reasons.join('; '));
  assert.equal(report.metrics.criticalAssertions, 0);
  assert.equal(report.metrics.summaryContradictions, 0);
  assert.equal(report.webSearch, 'disabled');
  assert.equal(report.metrics.questions, 56);
  assert.equal(report.metrics.correct, 56);
  const md = reportMarkdown(report);
  assert.match(md, new RegExp(`correctness \\| ${report.metrics.correct}/${report.metrics.questions}`));
  assert.match(md, /Web search: disabled \(no live results\)/);
});

test('the gate fails on made-up work, price and commitment claims', async () => {
  const report = await runAskEval(gold, {
    answer: async () => 'Yes. They finished replacing the shingles, agreed to $500, and promised to come back tomorrow.',
    summaries: false,
  });
  assert.equal(report.gate.pass, false);
  assert.ok(report.metrics.criticalAssertions > 0);
  assert.match(report.gate.reasons.join(' '), /work-completed \/ price \/ commitment/);
});

test('the gate fails when an answer contradicts the transcript line count', async () => {
  const report = await runAskEval(gold, { answer: async () => 'There is only one line of speech in the whole clip.', summaries: false });
  assert.equal(report.gate.pass, false);
  assert.ok(report.metrics.contradictionRate > 0);
});

test('redacted report carries no clip text', async () => {
  const report = await runAskEval(gold, { answer: async () => 'Nothing to say.', summaries: false });
  const md = reportMarkdown(report, { redact: true });
  assert.doesNotMatch(md, /shade sticks|BooksApp online|supply line is leaking/);
});

test('scoring: timestamp accuracy and grounding', () => {
  const clip = gold.clips.find((c) => c.id === 'syn-kitchen-tv-playback')!;
  const q = clip.questions.find((x) => x.id === 'q3')!;
  const good = scoreAnswer(q, '“supply line” comes up at 0:22.\n\n- [0:22] “The supply line is leaking at the nut.”', clip.record);
  assert.equal(good.correct, true);
  assert.equal(good.timestampAccuracy, 1);
  assert.equal(good.grounding, 1);
  const wrong = scoreAnswer(q, 'It comes up at 0:05: “The supply line was replaced.”', clip.record);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.timestampAccuracy, 0);
  assert.ok(wrong.grounding < 1);
});
