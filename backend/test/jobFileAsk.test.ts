import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFromJobFile,
  countJobFileSources,
  formatJobFileRecord,
  groundedJobFileAnswer,
  jobFileHasContent,
  preferJobFileGroundedFastPath,
  type JobFileAskContext,
} from '../src/shared/jobFileAsk.js';
import { pickAskToolsHeuristically } from '../src/shared/askTools.js';

const file: JobFileAskContext = {
  job: {
    title: 'Cedar Ridge — storm damage',
    jobNumber: 1038,
    claimNumber: 'CLM-88396',
    status: 'in_progress',
    description: 'Roof tarp and rebuild after hail.',
  },
  facts: {
    'Site address': '2214 Cedar Ridge Dr, Round Rock TX',
    'Gate / access': 'Lockbox on the side gate — 4412',
    'Permit': 'BP-2026-8841',
  },
  briefNote: 'Carrier approved the deck replacement; skylights removed from scope.',
  scope: [
    {
      state: 'excluded',
      title: 'Do not remove the skylights',
      reason: 'Carrier declined them. Removing them is unpaid work.',
    },
    { state: 'included', title: 'Tear off and replace roof' },
  ],
  messages: [
    { author: 'Homeowner', body: 'Please do not touch the skylights — we have a separate guy for those.' },
  ],
  parties: [{ company: 'Delgado Roofing', trade: 'roofing', contact: 'Hector Delgado' }],
  tasks: [{ title: 'Call the carrier about the valley rot', status: 'todo', assignee: 'Priya Shah' }],
  clips: [
    {
      workDate: '2026-08-05',
      phase: 'after',
      company: 'Delgado Roofing',
      summary: 'North slope stripped to decking; underlayment down on two thirds.',
      transcript: 'Homeowner asked us not to touch the skylights.',
    },
  ],
};

test('formatJobFileRecord includes brief facts, scope, notes, and clips', () => {
  const text = formatJobFileRecord(file);
  assert.match(text, /2214 Cedar Ridge Dr/);
  assert.match(text, /Lockbox on the side gate/);
  assert.match(text, /\[excluded\] Do not remove the skylights/);
  assert.match(text, /Homeowner: Please do not touch the skylights/);
  assert.match(text, /Delgado Roofing/);
  assert.match(text, /Call the carrier about the valley rot/);
  assert.match(text, /Heard on the mic(?: \(verbatim\))?: Homeowner asked us not to touch the skylights/);
  assert.match(text, /CLM-88396/);
});

test('groundedJobFileAnswer reads a brief field that is not a video', () => {
  const answer = groundedJobFileAnswer('what is the lockbox', file);
  assert.match(answer, /4412/);
  assert.match(answer, /Gate \/ access|lockbox/i);
});

test('groundedJobFileAnswer reads the site address from arbitrary brief facts', () => {
  const answer = groundedJobFileAnswer('what is the site address', file);
  assert.match(answer, /2214 Cedar Ridge Dr/);
});

test('groundedJobFileAnswer reads a do-not from scope', () => {
  const answer = groundedJobFileAnswer('should we remove the skylights', file);
  assert.match(answer, /skylights/i);
  assert.match(answer, /excluded|do not|unpaid/i);
});

test('groundedJobFileAnswer reads a task that is not on a clip', () => {
  const answer = groundedJobFileAnswer('what task is about the carrier', file);
  assert.match(answer, /valley rot/i);
});

test('groundedJobFileAnswer still finds a clip transcript', () => {
  const answer = groundedJobFileAnswer('what did the homeowner say about the skylights', file);
  assert.match(answer, /skylights/i);
});

test('groundedJobFileAnswer works when the file has no videos', () => {
  const briefOnly: JobFileAskContext = {
    facts: { 'Dry standard': '16% WME, control reading 12%' },
    scope: [{ state: 'excluded', title: 'Do not pull the hardwood in the dining room' }],
  };
  assert.equal(jobFileHasContent(briefOnly), true);
  assert.match(groundedJobFileAnswer('what is the dry standard', briefOnly), /16% WME/);
  assert.match(groundedJobFileAnswer('can we pull the hardwood', briefOnly), /dining room/);
});

test('groundedJobFileAnswer does not invent a fact', () => {
  const answer = groundedJobFileAnswer('what is the dumpster color', file);
  assert.match(answer, /does not have that/i);
});

test('empty file says so', () => {
  assert.equal(jobFileHasContent({}), false);
  assert.match(groundedJobFileAnswer('anything?', {}), /nothing is on this job file/i);
  assert.equal(countJobFileSources({}), 0);
});

test('answerFromJobFile uses the grounded file when no model key is wired', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const result = await answerFromJobFile({ question: 'what is the permit number', file, apiKey: null });
    assert.equal(result.model, null);
    assert.match(result.answer, /BP-2026-8841/);
    assert.ok(result.groundedOn >= 4);
  } finally {
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
  }
});

test('preferJobFileGroundedFastPath refuses web / capability / price asks', () => {
  const briefHit = 'brief · Carrier approved the deck replacement; skylights removed from scope.';
  assert.equal(preferJobFileGroundedFastPath('what is the permit number', 'brief · Permit: BP-2026-8841'), true);
  assert.equal(preferJobFileGroundedFastPath('search the web for tile prices', briefHit), false);
  assert.equal(preferJobFileGroundedFastPath('can u search google', briefHit), false);
  assert.equal(preferJobFileGroundedFastPath('what can you search for', briefHit), false);
  assert.equal(preferJobFileGroundedFastPath('tile prices', briefHit), false);
  assert.equal(preferJobFileGroundedFastPath('how much does tile cost', briefHit), false);
});

test('pickAskToolsHeuristically includes web_search for topical web intents, not capability-only', () => {
  for (const q of ['search the web for tile prices', 'google IRC R905']) {
    const picks = pickAskToolsHeuristically(q, 'org');
    assert.ok(picks.includes('web_search'), `expected web_search for: ${q} got ${picks.join(',')}`);
    assert.equal(picks[0], 'web_search', `web_search should be first for: ${q}`);
  }
  for (const q of ['can u search google', 'what can you search for', 'can you search the web?']) {
    const picks = pickAskToolsHeuristically(q, 'org');
    assert.ok(
      !picks.includes('web_search'),
      `capability-only should not fetch google junk via web_search: ${q} got ${picks.join(',')}`,
    );
  }
});

test('answerFromJobFile searches topical web asks but skips capability-only', async () => {
  const prev = {
    ASK_WEB_SEARCH_API_KEY: process.env.ASK_WEB_SEARCH_API_KEY,
    ASK_WEB_SEARCH_PROVIDER: process.env.ASK_WEB_SEARCH_PROVIDER,
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  process.env.ASK_WEB_SEARCH_API_KEY = 'test-key';
  process.env.ASK_WEB_SEARCH_PROVIDER = 'brave';
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  let searched = false;
  try {
    // Topical web ask still searches before grounded fast-path
    searched = false;
    const topical = await answerFromJobFile({
      question: 'search the web for tile prices',
      file,
      apiKey: null,
      fetchFn: async () => {
        searched = true;
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: 'Tile price guide',
                  url: 'https://example.com/tile-prices',
                  description: 'Average tile prices',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    assert.equal(searched, true, 'expected searchAskWeb for topical web ask');
    assert.ok(topical.webHits.length >= 1, 'expected webHits for topical web ask');
    assert.equal(topical.webHits[0]?.url, 'https://example.com/tile-prices');

    // Capability-only: no live fetch (avoids google.com homepage junk citations)
    for (const question of ['can u search google', 'what can you search for']) {
      searched = false;
      const result = await answerFromJobFile({
        question,
        file,
        apiKey: null,
        fetchFn: async () => {
          searched = true;
          return new Response('should not run', { status: 500 });
        },
      });
      assert.equal(searched, false, `capability-only must not search: ${question}`);
      assert.equal(result.webHits.length, 0, `capability-only must not attach webHits: ${question}`);
    }
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
