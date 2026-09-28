/**
 * Ask speed path: routing, cached prompt prefix, timing logs, deferred summary.
 * No provider keys. Timing numbers here are from the test process, not production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldThreadMemory, type StoredAskPair } from '../src/shared/askMemory.js';
import { fastAnswerNeedsDeepFallback, routeAskQuestion } from '../src/shared/askRoute.js';
import {
  anthropicCachedSystem,
  flushGeminiContextCaches,
  geminiCacheCreateBody,
  geminiCachedContentName,
  resetGeminiContextCachesForTests,
} from '../src/shared/askPromptCache.js';
import { askTurnLogFields, createAskTurnClock, logAskTurnTiming } from '../src/shared/askTiming.js';
import {
  ASK_CONTEXT_BUDGET,
  formatAskJobContext,
  splitLookupPrompt,
  type AskLookupCatalog,
  type AskLookupClip,
} from '../src/shared/askLookup.js';
import { partitionAskTools } from '../src/shared/askTools.js';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';

const catalog: AskLookupCatalog = {
  orgId: 'org',
  jobId: 'job',
  access: 'org',
  jobTitle: 'Project Tiffany',
  clips: [],
  people: [],
  history: [],
};

test('simple lookups, quotes, greetings, and follow-ups stay on the fast model', () => {
  assert.equal(routeAskQuestion({ question: 'Hey', catalog }).route, 'fast');
  assert.equal(routeAskQuestion({ question: 'Thanks', catalog }).reason, 'thanks');
  assert.equal(
    routeAskQuestion({
      question: 'and on Sep 21?',
      resolved: 'What did El Presidente say on Sep 21?',
      catalog,
    }).reason,
    'follow_up',
  );
  assert.equal(routeAskQuestion({ question: 'What did El Presidente say on Sep 21?', catalog }).reason, 'quote');
  assert.equal(routeAskQuestion({ question: 'What was said on Sep 21?', catalog }).reason, 'quote');
  assert.equal(routeAskQuestion({ question: 'who opened this job', catalog }).reason, 'lookup');
});

test('drafts, comparisons, overviews, and other jobs stay on the deep model', () => {
  assert.equal(routeAskQuestion({ question: 'draft an email to the homeowner', catalog }).route, 'deep');
  assert.equal(routeAskQuestion({ question: 'draft an estimate', catalog }).reason, 'task_estimate');
  assert.equal(routeAskQuestion({ question: 'compare the two visits', catalog }).route, 'deep');
  assert.equal(routeAskQuestion({ question: 'what was this job about', catalog }).reason, 'overview');
  assert.equal(
    routeAskQuestion({ question: 'What has all happened on this file so far', catalog }).reason,
    'overview',
  );
  assert.equal(routeAskQuestion({ question: 'Have we seen a tarp on other jobs?', catalog }).reason, 'other_jobs');
  assert.equal(
    routeAskQuestion({ question: 'You got the date wrong. That was Sep 17.', catalog }).reason,
    'correction',
  );
});

test('an ungrounded fast answer falls back, a grounded one does not', () => {
  assert.equal(fastAnswerNeedsDeepFallback('What did he say about the tarp?', '', false), true);
  assert.equal(fastAnswerNeedsDeepFallback('What did he say about the tarp?', 'Not sure.', false), true);
  assert.equal(
    fastAnswerNeedsDeepFallback('What did he say about the tarp?', 'He said the tarp came off.', true),
    false,
  );
  assert.equal(fastAnswerNeedsDeepFallback('Hey', 'This file is Project Tiffany.', false), false);
});

test('the timing log is structured and has no transcript or question text', () => {
  const clock = createAskTurnClock(1_000);
  clock.contextBuildMs = 40;
  clock.memoryLoadMs = 12;
  clock.noteRoute('fast', 'quote');
  clock.noteModel('claude-sonnet-5');
  clock.addTool('get_clip', 3);
  clock.addTool('transcript: the lockbox code is 4412', 9);
  clock.markFirstToken();
  const fields = askTurnLogFields(clock.snapshot(1_500));
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line ?? ''));
  };
  try {
    logAskTurnTiming(clock.snapshot(1_800));
  } finally {
    console.log = original;
  }
  const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((row) => row.msg === 'ask_turn');
  assert.ok(logged);
  assert.equal(logged?.event, 'ask_turn');
  assert.equal(logged?.route, 'fast');
  assert.equal(logged?.routeReason, 'quote');
  assert.equal(logged?.model, 'claude-sonnet-5');
  assert.equal(typeof logged?.ttftMs, 'number');
  assert.equal(typeof logged?.totalMs, 'number');
  assert.equal(logged?.contextBuildMs, 40);
  assert.equal(logged?.memoryLoadMs, 12);
  const blob = JSON.stringify(logged);
  assert.doesNotMatch(blob, /4412|lockbox|transcript|What did/);
  assert.match(blob, /get_clip/);
  assert.equal(fields.question, undefined);
  const tools = logged?.tools as Array<{ name: string }>;
  assert.equal(tools[1]?.name, 'tool');
});

test('the prompt reuses the stored summary and does not rebuild it first', () => {
  const pairs: StoredAskPair[] = [
    { id: 'a', question: 'Routine check', answer: 'Noted.', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'b', question: 'We decided to redo the tabletop in walnut.', answer: 'Noted.', createdAt: '2026-09-02T00:00:00.000Z' },
  ];
  const folded = foldThreadMemory({
    pairs,
    previousSummary: 'Earlier turns: decided walnut.',
    summarizedThroughId: 'b',
    reuseSummary: true,
  });
  assert.equal(folded.summary, 'Earlier turns: decided walnut.');
  assert.equal(folded.regenerate, false);
  assert.match(folded.recent.map((turn) => turn.text).join(' '), /walnut/);
});

test('a reused summary still includes turns the recent window has already passed', () => {
  const pairs: StoredAskPair[] = [
    { id: '1', question: 'Keep summaries brief.', answer: 'Noted.', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: '2', question: 'We decided to redo the tabletop in walnut.', answer: 'Noted.', createdAt: '2026-09-02T00:00:00.000Z' },
    { id: '3', question: 'Routine 3', answer: 'Ok.', createdAt: '2026-09-03T00:00:00.000Z' },
    { id: '4', question: 'Routine 4', answer: 'Ok.', createdAt: '2026-09-04T00:00:00.000Z' },
    { id: '5', question: 'Routine 5', answer: 'Ok.', createdAt: '2026-09-05T00:00:00.000Z' },
    { id: '6', question: 'Routine 6', answer: 'Ok.', createdAt: '2026-09-06T00:00:00.000Z' },
  ];
  const folded = foldThreadMemory({
    pairs,
    previousSummary: 'Earlier turns: keep summaries brief.',
    summarizedThroughId: '1',
    reuseSummary: true,
  });
  assert.match(folded.summary, /keep summaries brief/);
  assert.match(folded.summary, /walnut/);
  assert.equal(
    folded.recent.some((turn) => /walnut/.test(turn.text)),
    false,
  );
  assert.match(folded.recent.map((turn) => turn.text).join(' '), /Routine 6/);
  assert.equal(folded.regenerate, true);
});

test('stable job context is cached ahead of the question and stays redacted', () => {
  const secret: AskLookupClip = {
    proofId: 'p1',
    jobId: 'job',
    orgId: 'org',
    title: 'Office',
    workDate: '2026-09-17',
    summary: 'Office check-in.',
    segments: [
      { start: 1, end: 2, text: 'The tarp came off.' },
      { start: 11, end: 12, text: 'The lockbox code is 4412.' },
    ],
    privacyRedactions: { ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }] },
  };
  const file: AskLookupCatalog = { ...catalog, clips: [secret], jobTitle: 'Project Tiffany' };
  const split = splitLookupPrompt({ question: 'what did he say about the tarp', catalog: file });
  const blocks = anthropicCachedSystem('You answer from the job file.', split.stable);
  assert.equal(blocks[0]?.cache_control?.type, 'ephemeral');
  assert.equal(blocks[1]?.cache_control?.type, 'ephemeral');
  assert.match(blocks[1]?.text ?? '', /Job context/);
  assert.match(blocks[1]?.text ?? '', /tarp came off/);
  assert.doesNotMatch(blocks[1]?.text ?? '', /4412/);
  assert.doesNotMatch(blocks[1]?.text ?? '', /what did he say/);
  assert.match(split.volatile, /Question: what did he say/);
  assert.equal(split.stable, splitLookupPrompt({ question: 'who opened this job', catalog: file }).stable);
});

test('a large file keeps every clip title and drops transcripts past the budget', () => {
  const clips: AskLookupClip[] = Array.from({ length: 20 }, (_, index) => ({
    proofId: `clip-${index}`,
    jobId: 'job',
    orgId: 'org',
    title: `Visit ${index}`,
    workDate: '2026-09-17',
    summary: 'A short visit note.',
    segments: [{ start: 0, end: 1, text: `Spoken line ${index} `.repeat(80) }],
  }));
  const secret = clips[3]!;
  secret.segments = [
    { start: 0, end: 1, text: 'The gate code is 9088.' },
    { start: 2, end: 3, text: 'Visible work note.' },
  ];
  secret.privacyRedactions = {
    ranges: [{ startSec: 0, endSec: 1.5, reason: 'private', confidence: 0.9, source: 'vision' }],
  };
  const text = formatAskJobContext({ ...catalog, clips });
  assert.ok(text.length <= ASK_CONTEXT_BUDGET);
  for (const clip of clips) assert.match(text, new RegExp(clip.title));
  assert.doesNotMatch(text, /9088/);
});

test('independent reads run together and writes stay first', () => {
  const parts = partitionAskTools(['get_punch_list', 'update_job_fields', 'get_job_status', 'propose_revoke_access']);
  assert.deepEqual(parts.sequential, ['update_job_fields', 'propose_revoke_access']);
  assert.deepEqual(parts.parallel, ['get_punch_list', 'get_job_status']);
});

test('gemini context cache does not block the first sight of a job', async () => {
  resetGeminiContextCachesForTests();
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ name: 'cachedContents/job-1' }), { status: 200 });
  };
  const stable = 'Job context:\n' + 'clip line\n'.repeat(200);
  const first = geminiCachedContentName({
    apiKey: 'test',
    model: 'gemini-2.5-flash',
    system: 'system',
    stable,
    fetchFn,
  });
  assert.equal(first, null);
  assert.equal(calls.length, 0);
  const second = geminiCachedContentName({
    apiKey: 'test',
    model: 'gemini-2.5-flash',
    system: 'system',
    stable,
    fetchFn,
  });
  assert.equal(second, null);
  await flushGeminiContextCaches();
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? '', /cachedContents/);
  const body = geminiCacheCreateBody({ model: 'gemini-2.5-flash', system: 'system', stable });
  assert.equal((body.contents as Array<{ role: string }>)[0]?.role, 'user');
  const third = geminiCachedContentName({
    apiKey: 'test',
    model: 'gemini-2.5-flash',
    system: 'system',
    stable,
    fetchFn,
  });
  assert.equal(third, 'cachedContents/job-1');
  resetGeminiContextCachesForTests();
});

function anthropicText(text: string, model: string): string {
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    event('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_fast',
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 1 },
      },
    }),
    event('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    event('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 8 },
    }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
}

test('a fast model that is not grounded falls back to the deep model', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-fast-fallback';
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  const models: string[] = [];
  const originalFetch = globalThis.fetch;
  const fetchFn: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    const model = body.model ?? '';
    models.push(model);
    const text = model.includes('opus') ? 'He said the tarp came off the north slope.' : 'Not sure.';
    return new Response(anthropicText(text, model), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  globalThis.fetch = fetchFn;
  try {
    const file: AskLookupCatalog = {
      ...catalog,
      clips: [
        {
          proofId: 'office',
          jobId: 'job',
          orgId: 'org',
          title: 'Office',
          workDate: '2026-09-17',
          segments: [{ start: 4, end: 6, text: 'The tarp came off the north slope.' }],
        },
      ],
    };
    const result = await answerFromAskLookup({
      question: 'What did he say about the tarp?',
      catalog: file,
      anthropicApiKey: 'sk-ant-test-fast-fallback',
      fetchFn,
    });
    assert.deepEqual(models, ['claude-sonnet-5', 'claude-opus-5']);
    assert.match(result.answer, /tarp came off/i);
    assert.equal(result.model, 'claude-opus-5');
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});
