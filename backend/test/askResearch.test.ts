/**
 * Research routing, the scratchpad, stop conditions, fallback, and quote checks.
 * Synthetic lines only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';
import type { AskLookupCatalog, AskLookupClip } from '../src/shared/askLookup.js';
import {
  addResearchRecords,
  createResearchScratchpad,
  routeAskResearch,
  runAskResearch,
  ASK_RESEARCH_BUDGET_MS,
  ASK_RESEARCH_MAX_STEPS,
} from '../src/shared/askResearch.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const JOB = '00000000-0000-4000-8000-0000000000bb';

function clip(partial: Partial<AskLookupClip> & Pick<AskLookupClip, 'proofId' | 'title'>): AskLookupClip {
  return { jobId: JOB, orgId: ORG, ...partial };
}

const kitchen: AskLookupCatalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Synthetic Kitchen Visits',
  timeZone: 'America/Chicago',
  people: [],
  history: [],
  clips: [
    clip({
      proofId: '00000000-0000-4000-8000-00000000c101',
      title: 'First kitchen visit',
      workDate: '2026-09-03',
      segments: [
        { start: 8, end: 11, text: 'The budget is twelve thousand.', speaker: 'SPEAKER_0' },
        { start: 14, end: 16, text: 'We will measure the wall.', speaker: 'SPEAKER_0' },
      ],
    }),
    clip({
      proofId: '00000000-0000-4000-8000-00000000c102',
      title: 'Last kitchen visit',
      workDate: '2026-09-17',
      segments: [{ start: 22, end: 25, text: 'The budget moved to fifteen thousand.', speaker: 'SPEAKER_0' }],
    }),
  ],
  orgClips: [
    clip({
      proofId: '00000000-0000-4000-8000-00000000c201',
      jobId: '00000000-0000-4000-8000-00000000c301',
      title: 'Similar kitchen walkthrough',
      jobTitle: 'Similar kitchen job',
      workDate: '2026-08-12',
      segments: [{ start: 5, end: 8, text: 'Their budget was ten thousand.', speaker: 'SPEAKER_0' }],
    }),
  ],
};

function withoutModelKeys<T>(fn: () => Promise<T>): Promise<T> {
  const prev = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  return fn().finally(() => {
    if (prev.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev.anthropic;
    if (prev.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev.gemini;
    if (prev.google === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prev.google;
  });
}

test('research constants are fixed, not environment', () => {
  assert.equal(ASK_RESEARCH_MAX_STEPS, 4);
  assert.equal(ASK_RESEARCH_BUDGET_MS, 20_000);
});

test('routeAskResearch sends hard questions to the loop and simple ones past it', () => {
  assert.equal(routeAskResearch('who opened this job').route, 'single');
  assert.equal(routeAskResearch('how many spoken lines are in this clip').route, 'single');
  assert.equal(routeAskResearch('What was said first and what was said last?').route, 'single');
  assert.equal(routeAskResearch('What changed between the first and last visit?').reason, 'timeline');
  assert.equal(routeAskResearch('List every time the homeowner mentioned budget across clips.').reason, 'enumeration');
  assert.equal(routeAskResearch('Compare this job to the last similar job.').reason, 'comparison');
  assert.equal(routeAskResearch('What was said about LedgerPro? Who committed?').reason, 'multi_part');
  assert.equal(routeAskResearch('compare the two visits').route, 'research');
});

test('the scratchpad keeps one record per chunk id', () => {
  const pad = createResearchScratchpad();
  const row = {
    id: 'chunk-1',
    kind: 'chunk' as const,
    proofId: 'p',
    jobId: JOB,
    clipTitle: 'First kitchen visit',
    startSec: 8,
    speaker: 'Speaker 1',
    text: 'The budget is twelve thousand.',
    cite: null,
  };
  assert.equal(addResearchRecords(pad, [row, { ...row }]), 1);
  assert.equal(addResearchRecords(pad, [row]), 0);
  assert.equal(pad.records.length, 1);
});

test('heuristic research stops when the timeline is covered', async () => {
  await withoutModelKeys(async () => {
    const researched = await runAskResearch({
      question: 'What changed between the first and last visit?',
      catalog: kitchen,
    });
    assert.equal(researched.meta.stopReason, 'sufficient');
    assert.ok(researched.meta.steps.length >= 1);
    assert.ok(researched.meta.steps.length <= ASK_RESEARCH_MAX_STEPS);
    assert.match(researched.answer, /twelve thousand/);
    assert.match(researched.answer, /fifteen thousand/);
    assert.match(researched.answer, /Speaker 1/);
    assert.doesNotMatch(researched.answer, /the homeowner said/i);
    const tools = researched.meta.steps.flatMap((step) => step.tools);
    assert.equal(tools.filter((tool) => tool === 'list_clips').length, 1);
  });
});

test('a wall-clock budget stops the loop before the step cap', async () => {
  await withoutModelKeys(async () => {
    let ticks = 0;
    let n = 0;
    const researched = await runAskResearch({
      question: 'List every time the homeowner mentioned budget across clips.',
      catalog: kitchen,
      budgetMs: 20_000,
      now: () => (ticks++ < 8 ? 0 : 21_000),
      complete: async ({ kind }) => {
        if (kind === 'plan') {
          n += 1;
          return { text: JSON.stringify({ calls: [{ tool: 'search_transcripts', query: `budget ${n}` }] }) };
        }
        if (kind === 'sufficiency') return { text: '{"sufficient":false,"covered":[],"gaps":["more"]}' };
        return { text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08).' };
      },
    });
    assert.equal(researched.meta.stopReason, 'budget');
    assert.ok(researched.meta.steps.length >= 1);
    assert.ok(researched.meta.steps.length < ASK_RESEARCH_MAX_STEPS);
    assert.match(researched.answer, /twelve thousand/);
    const logged = JSON.stringify(researched.meta);
    assert.doesNotMatch(logged, /twelve thousand/);
  });
});

test('sufficiency stops after one step when the model says the question is covered', async () => {
  await withoutModelKeys(async () => {
    const kinds: string[] = [];
    const researched = await runAskResearch({
      question: 'List every time the homeowner mentioned budget across clips.',
      catalog: kitchen,
      complete: async ({ kind }) => {
        kinds.push(kind);
        if (kind === 'plan') return { text: '{"calls":[{"tool":"search_transcripts","query":"budget"}]}' };
        if (kind === 'sufficiency') return { text: '{"sufficient":true,"covered":["budget"],"gaps":[]}' };
        return { text: 'Budget comes up 2 times. Speaker 1 said “The budget is twelve thousand.”' };
      },
    });
    assert.equal(researched.meta.stopReason, 'sufficient');
    assert.equal(researched.meta.steps.length, 1);
    assert.deepEqual(kinds, ['plan', 'sufficiency', 'synthesis']);
  });
});

test('the step cap stops a model that never calls the question covered', async () => {
  await withoutModelKeys(async () => {
    let n = 0;
    const researched = await runAskResearch({
      question: 'List every time the homeowner mentioned budget across clips.',
      catalog: kitchen,
      complete: async ({ kind }) => {
        if (kind === 'plan') {
          n += 1;
          return { text: JSON.stringify({ calls: [{ tool: 'search_transcripts', query: `budget ${n}` }] }) };
        }
        if (kind === 'sufficiency') return { text: '{"sufficient":false,"covered":[],"gaps":["more"]}' };
        return { text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08).' };
      },
    });
    assert.equal(researched.meta.stopReason, 'max_steps');
    assert.equal(researched.meta.steps.length, ASK_RESEARCH_MAX_STEPS);
  });
});

test('a research failure falls back to the single-pass answer', async () => {
  await withoutModelKeys(async () => {
    const looked = await answerFromAskLookup({
      question: 'compare the two visits',
      catalog: kitchen,
      step: async () => null,
      research: { complete: async () => { throw new Error('model down'); } },
    });
    assert.equal(looked.research?.stopReason, 'fallback');
    assert.match(looked.answer, /Visit/);
    assert.match(looked.answer, /⟦artifact⟧/);
  });
});

test('an invented quote in a research answer is dropped', async () => {
  await withoutModelKeys(async () => {
    const looked = await answerFromAskLookup({
      question: 'What changed between the first and last visit?',
      catalog: kitchen,
      research: {
        complete: async ({ kind }) => {
          if (kind === 'plan') {
            return { text: '{"calls":[{"tool":"get_clip","proofId":"00000000-0000-4000-8000-00000000c101"},{"tool":"get_clip","proofId":"00000000-0000-4000-8000-00000000c102"}]}' };
          }
          if (kind === 'sufficiency') return { text: '{"sufficient":true,"covered":["both visits"],"gaps":[]}' };
          return {
            text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08). Someone said “The roof is solid gold.”',
          };
        },
      },
    });
    assert.match(looked.answer, /twelve thousand/);
    assert.doesNotMatch(looked.answer, /solid gold/);
    assert.equal(looked.research?.stopReason, 'sufficient');
  });
});

test('a simple question does not enter the research loop', async () => {
  await withoutModelKeys(async () => {
    let planned = 0;
    const started = performance.now();
    for (let i = 0; i < 1000; i += 1) routeAskResearch('who opened this job');
    const routeMs = performance.now() - started;
    const simpleStarted = performance.now();
    const looked = await answerFromAskLookup({
      question: 'who opened this job',
      catalog: {
        ...kitchen,
        history: [
          {
            id: '18346820-5594-43cf-9e8b-a13aed56ac95',
            jobId: JOB,
            orgId: ORG,
            summary: 'opened job #12 — Synthetic Kitchen Visits',
            at: '2026-09-17T16:37:28.774Z',
            actorId: null,
          },
        ],
      },
      step: async () => null,
      research: {
        complete: async () => {
          planned += 1;
          return { text: '{"calls":[]}' };
        },
      },
    });
    const simpleMs = performance.now() - simpleStarted;
    assert.equal(planned, 0);
    assert.equal(looked.research ?? null, null);
    assert.match(looked.answer, /opened/i);
    assert.ok(routeMs < 50, `route ${routeMs.toFixed(2)}ms`);
    assert.ok(simpleMs < 1500, `simple ${simpleMs.toFixed(1)}ms`);
    console.log(`ask-research-latency route1000=${routeMs.toFixed(2)}ms simple=${simpleMs.toFixed(1)}ms`);
  });
});
