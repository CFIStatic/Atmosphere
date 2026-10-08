/**
 * Ask speed: live preview gate, one web search per turn, the general (public
 * question) fast path, label honesty for web replies, and model choices that
 * keep simple turns on fast models.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAskPreviewGate, previewSentenceSafe } from '../src/shared/askPreview.js';
import {
  createAskWebSearchMemo,
  isGeneralAsk,
  looksLikeThreadFollowUp,
  shouldSearchWebBeforeAnswer,
  type AskWebSearchFn,
} from '../src/shared/askWebSearch.js';
import { answerFromJobFile, answerGeneralQuestion, webBackedWithoutJobCite, type JobFileAskContext } from '../src/shared/jobFileAsk.js';
import { uploadAnswerModel } from '../src/shared/askUploadAnswer.js';
import { routeAskQuestion } from '../src/shared/askRoute.js';
import { askFastAnthropicModel, askInteractiveDeepEffort } from '../src/lib/askModel.js';
import { createAskTurnClock } from '../src/shared/askTiming.js';

function gate() {
  const shown: string[] = [];
  let resets = 0;
  const g = createAskPreviewGate({ emit: (t) => shown.push(t), reset: () => (resets += 1) });
  return { g, shown, resets: () => resets };
}

test('preview shows whole safe sentences as they finish', () => {
  const { g, shown } = gate();
  g.push('The Yankees are');
  assert.deepEqual(shown, []);
  g.push(' favored tonight. Cole');
  assert.equal(shown.join(''), 'The Yankees are favored tonight.');
  g.push(' starts at home. ');
  assert.equal(shown.join(''), 'The Yankees are favored tonight. Cole starts at home.');
});

test('preview holds back quotes, cites, links, and everything after them', () => {
  const { g, shown } = gate();
  g.push('He mentioned the tarp. He said "it came off Tuesday." Then the crew left. ');
  assert.equal(shown.join(''), 'He mentioned the tarp.');
  for (const unsafe of ['See https://x.com now.', 'Clip video/0123abcd-ef01 shows it.', 'Use ⟦cite⟧ here.']) {
    assert.equal(previewSentenceSafe(unsafe), false, unsafe);
  }
});

test('preview stops for good at a machine line', () => {
  const { g, shown } = gate();
  g.push('The permit is posted.\n\n⟦sources: brief⟧ More text. ');
  assert.equal(shown.join('').trim(), 'The permit is posted.');
  g.push('Even more. ');
  assert.equal(shown.join('').trim(), 'The permit is posted.');
});

test('preview runs the caller check and closes on the first rejected sentence', () => {
  const { g, shown } = gate();
  g.setCheck((sentence) => !/Sep 30/.test(sentence));
  g.push('The roof was tarped. The inspection is Sep 30. The crew is booked. ');
  assert.equal(shown.join(''), 'The roof was tarped.');
});

test('preview reset tells the reader only when something was shown', () => {
  const { g, shown, resets } = gate();
  g.reset();
  assert.equal(resets(), 0);
  g.push("Let me check the clips. ");
  assert.equal(shown.length, 1);
  g.reset();
  assert.equal(resets(), 1);
  assert.equal(g.shown(), 0);
  g.push('Found it. ');
  assert.equal(shown.at(-1), 'Found it.');
});

test('turn clock records the first visible preview separately from the first model token', () => {
  const clock = createAskTurnClock(Date.now() - 50);
  clock.markFirstToken();
  assert.equal(clock.visibleTtftMs, null);
  clock.markFirstVisible();
  const snap = clock.snapshot();
  assert.ok(snap.ttftMs != null && snap.visibleTtftMs != null);
  assert.ok(snap.visibleTtftMs! >= snap.ttftMs!);
});

test('web search memo runs one search per query per turn', async () => {
  let calls = 0;
  const prev = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'tvly-test-not-real';
  try {
    const search = createAskWebSearchMemo({
      fetchFn: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ results: [{ title: 'Odds', url: 'https://example.com/odds', content: 'Yankees -150' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    const [a, b] = await Promise.all([
      search('whos going to win the ball game', { limit: 5 }),
      search('Whos going to win the ball game ', { limit: 5 }),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.hits.length, 1);
    assert.strictEqual(a, b);
    await search('weather in Round Rock', { limit: 5 });
    assert.equal(calls, 2);
  } finally {
    if (prev === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = prev;
  }
});

test('public questions route to the general fast path; job questions do not', () => {
  for (const q of ['whos going to win the ball game', "who's going to win the game tonight", 'what is the weather tomorrow']) {
    assert.equal(isGeneralAsk(q), true, q);
    assert.equal(routeAskQuestion({ question: q }).route, 'fast', q);
  }
  for (const q of ['what is the lockbox code', 'what did he say about the tarp', 'draft an email to the homeowner']) {
    assert.equal(isGeneralAsk(q), false, q);
  }
});

const file: JobFileAskContext = {
  job: { title: 'Cedar Ridge — storm damage', status: 'in_progress' },
  facts: { 'Gate / access': 'Lockbox on the side gate — 4412' },
  clips: [],
};

const ballGameSearch: AskWebSearchFn = async () => ({
  hits: [
    { title: 'Rays at Yankees odds', url: 'https://example.com/odds', snippet: 'Yankees -150 at home, Cole starting.' },
    { title: 'Guardians vs White Sox', url: 'https://example.com/cle', snippet: 'Guardians favored -170.' },
  ],
  answer: '',
});

test('a public question gets one search and one fast streamed answer, labeled as web', async () => {
  const tokens: string[] = [];
  const statuses: string[] = [];
  let searches = 0;
  let prompt = '';
  let model: string | null | undefined;
  const result = await answerFromJobFile({
    question: 'whos going to win the ball game',
    file,
    apiKey: null,
    now: new Date('2026-10-08T01:28:00.000Z'),
    webSearch: async (query, opts) => {
      searches += 1;
      return ballGameSearch(query, opts);
    },
    onToken: (t) => tokens.push(t),
    onStatus: (s) => statuses.push(s),
    generalComplete: async (input) => {
      prompt = `${input.system}\n${input.user}`;
      model = input.anthropicModel;
      input.onToken?.('The Yankees are favored at home tonight, ');
      input.onToken?.('and the Guardians are favored over the White Sox.');
      return {
        text: 'The Yankees are favored at home tonight, and the Guardians are favored over the White Sox.',
        model: 'claude-sonnet-5-5',
        usage: null,
      };
    },
  });
  assert.equal(searches, 1);
  assert.equal(model, askFastAnthropicModel());
  assert.match(prompt, /who is favored/i);
  assert.match(prompt, /Never open with what you could not find/i);
  assert.match(prompt, /CURRENT DATE AND TIME|Today/i);
  assert.match(prompt, /Yankees -150/);
  assert.ok(tokens.length >= 1);
  assert.ok(statuses.includes('Searching the web…'));
  assert.equal(result.groundedOn, 0);
  assert.equal(result.webDerivedAnswer, true);
  assert.equal(result.webHits.length, 2);
  assert.match(result.answer, /Yankees are favored/);
  assert.doesNotMatch(result.answer, /4412/);
});

test('the general answer reuses a prefetched search (no second round trip)', async () => {
  let fetches = 0;
  const prev = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'tvly-test-not-real';
  try {
    const memo = createAskWebSearchMemo({
      fetchFn: async () => {
        fetches += 1;
        return new Response(JSON.stringify({ results: [{ title: 'Odds', url: 'https://example.com/o', content: 'Yankees -150' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const prefetch = memo('whos going to win the ball game', { limit: 5, includeDomains: [] });
    const answered = await answerGeneralQuestion({
      question: 'whos going to win the ball game',
      webSearch: memo,
      complete: async () => ({ text: 'The Yankees are slight favorites.', model: 'claude-sonnet-5-5', usage: null }),
    });
    await prefetch;
    assert.equal(fetches, 1);
    assert.match(answered?.answer ?? '', /favorites/);
  } finally {
    if (prev === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = prev;
  }
});

test('a job question never takes the general path', async () => {
  let general = false;
  const result = await answerFromJobFile({
    question: 'what is the lockbox code',
    file,
    apiKey: null,
    webSearch: async () => {
      throw new Error('should not search');
    },
    generalComplete: async () => {
      general = true;
      return null;
    },
  });
  assert.equal(general, false);
  assert.match(result.answer, /4412/);
});

test('web-backed replies with no job cite lose the "From this job file" label', () => {
  const hit = [{ title: 'Odds', url: 'https://example.com', snippet: 'x' }];
  assert.equal(webBackedWithoutJobCite('The Yankees are favored.', hit, ''), true);
  assert.equal(webBackedWithoutJobCite('The lockbox is 4412.', [], ''), false);
  assert.equal(webBackedWithoutJobCite('Anything.', [], '', true), true);
  assert.equal(
    webBackedWithoutJobCite('The tarp came off.\n\n⟦sources: video/job/proof-tarp/north@18⟧', hit, ''),
    false,
  );
});

test('simple upload reads use the fast model; summaries, money, and quotes stay deep', () => {
  assert.equal(uploadAnswerModel('what company is this from?'), askFastAnthropicModel());
  assert.equal(uploadAnswerModel('summarize this estimate'), null);
  assert.equal(uploadAnswerModel('what is the total price on this?'), null);
  assert.equal(uploadAnswerModel('quote the exclusions section'), null);
});

test('everyday deep turns default to medium effort; ASK_DEEP_EFFORT overrides', () => {
  const prev = process.env.ASK_DEEP_EFFORT;
  try {
    delete process.env.ASK_DEEP_EFFORT;
    assert.equal(askInteractiveDeepEffort(), 'medium');
    process.env.ASK_DEEP_EFFORT = 'high';
    assert.equal(askInteractiveDeepEffort(), 'high');
    process.env.ASK_DEEP_EFFORT = 'nonsense';
    assert.equal(askInteractiveDeepEffort(), 'medium');
  } finally {
    if (prev === undefined) delete process.env.ASK_DEEP_EFFORT;
    else process.env.ASK_DEEP_EFFORT = prev;
  }
});

test('thread follow-ups do not pay a blocking web search; public questions still do', () => {
  const prev = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'tvly-test-not-real';
  try {
    for (const q of ['and what happened after that?', 'why did he do that', 'what about the gutters']) {
      assert.equal(looksLikeThreadFollowUp(q), true, q);
      assert.equal(shouldSearchWebBeforeAnswer(q), false, q);
    }
    for (const q of ['whos going to win the ball game', 'what is the capital of France', 'search the web for tile prices']) {
      assert.equal(shouldSearchWebBeforeAnswer(q), true, q);
    }
    assert.equal(shouldSearchWebBeforeAnswer('what is the lockbox code'), false);
  } finally {
    if (prev === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = prev;
  }
});
