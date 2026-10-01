/**
 * Research routing, the scratchpad, stop conditions, fallback, and quote checks.
 * Synthetic lines only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromAskLookup, askLookupDeadlineAt, providerLookupStep } from '../src/shared/askReasoning.js';
import type { AskLookupCatalog, AskLookupClip } from '../src/shared/askLookup.js';
import {
  addResearchRecords,
  createResearchScratchpad,
  routeAskResearch,
  runAskResearch,
  ASK_RESEARCH_BUDGET_MS,
  ASK_RESEARCH_DEADLINE_MS,
  ASK_RESEARCH_MAX_STEPS,
  ASK_RESEARCH_SYNTHESIS_RESERVE_MS,
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

function hang(signal: AbortSignal | undefined, ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('hung past the deadline')), ms);
    const abort = () => {
      clearTimeout(timer);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (!signal) return;
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

test('research constants are fixed, not environment', () => {
  assert.equal(ASK_RESEARCH_MAX_STEPS, 4);
  assert.equal(ASK_RESEARCH_BUDGET_MS, 20_000);
  assert.equal(ASK_RESEARCH_SYNTHESIS_RESERVE_MS, 5_000);
  assert.equal(ASK_RESEARCH_DEADLINE_MS, 25_000);
});

test('routeAskResearch sends hard questions to the loop and simple ones past it', () => {
  assert.equal(routeAskResearch('who opened this job').route, 'single');
  assert.equal(routeAskResearch('how many spoken lines are in this clip').route, 'single');
  assert.equal(routeAskResearch('What was said first and what was said last?').route, 'single');
  assert.equal(routeAskResearch('What changed between the first and last visit?').reason, 'timeline');
  assert.equal(routeAskResearch('List every time the homeowner mentioned budget across clips.').reason, 'enumeration');
  assert.equal(routeAskResearch('Compare this job to the last similar job.').reason, 'comparison');
  assert.equal(routeAskResearch('What happened on the last job?').route, 'research');
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

test('a same-job visit comparison opens both visits before it stops', async () => {
  await withoutModelKeys(async () => {
    const researched = await runAskResearch({
      question: 'compare the two visits',
      catalog: kitchen,
    });
    const tools = researched.meta.steps.flatMap((step) => step.tools);
    assert.equal(researched.meta.stopReason, 'sufficient');
    assert.ok(tools.filter((tool) => tool === 'get_clip').length >= 2);
    assert.match(researched.answer, /\| Visit \|/);
    assert.match(researched.answer, /First kitchen visit/);
    assert.match(researched.answer, /Last kitchen visit/);
  });
});

test('a visit comparison opens the last visit when a middle clip is on file', async () => {
  await withoutModelKeys(async () => {
    const middle = clip({
      proofId: '00000000-0000-4000-8000-00000000c150',
      title: 'Middle kitchen visit',
      workDate: '2026-09-10',
      segments: [{ start: 4, end: 6, text: 'The tile is still on order.', speaker: 'SPEAKER_0' }],
    });
    const researched = await runAskResearch({
      question: 'compare the two visits',
      catalog: { ...kitchen, clips: [kitchen.clips[0]!, middle, kitchen.clips[1]!] },
    });
    const opened = researched.traceSteps.filter((step) => step.tool === 'get_clip').map((step) => String(step.input.proofId));
    assert.equal(researched.meta.stopReason, 'sufficient');
    assert.ok(opened.includes(kitchen.clips[0]!.proofId));
    assert.ok(opened.includes(kitchen.clips[1]!.proofId));
    assert.match(researched.answer, /First kitchen visit/);
    assert.match(researched.answer, /Last kitchen visit/);
  });
});

test('a cross-scope question opens clips instead of stopping on the list', async () => {
  await withoutModelKeys(async () => {
    const researched = await runAskResearch({
      question: 'summarize findings across clips',
      catalog: kitchen,
    });
    const tools = researched.meta.steps.flatMap((step) => step.tools);
    assert.ok(tools.includes('get_clip'));
    assert.doesNotMatch(researched.answer, /does not have visits/i);
    assert.match(researched.answer, /first kitchen visit/i);
    assert.match(researched.answer, /last kitchen visit/i);
  });
});

test('a similar-job comparison quotes the other job when those clips are loaded', async () => {
  await withoutModelKeys(async () => {
    const researched = await runAskResearch({
      question: 'Compare this job to the last similar job.',
      catalog: kitchen,
    });
    assert.match(researched.answer, /twelve thousand/);
    assert.match(researched.answer, /ten thousand/);
    assert.match(researched.answer, /Similar kitchen walkthrough/);
    assert.doesNotMatch(researched.answer, /No other job in this organization is loaded/);
  });
});

test('synthesis still sees a later clip after many filler transcripts are opened', async () => {
  await withoutModelKeys(async () => {
    const fillers = Array.from({ length: 5 }, (_, index) => {
      const n = String(index + 1).padStart(12, '0');
      return clip({
        proofId: `00000000-0000-4000-8000-${n}`,
        title: `Filler visit ${index + 1}`,
        workDate: '2026-09-01',
        segments: Array.from({ length: 10 }, (_, line) => ({
          start: line + 1,
          end: line + 2,
          text: `Filler line ${index + 1}-${line + 1} about nothing.`,
          speaker: 'SPEAKER_0',
        })),
      });
    });
    const budget = kitchen.clips[0]!;
    let synthesis = '';
    await runAskResearch({
      question: 'What changed between the first and last visit?',
      catalog: { ...kitchen, clips: [...fillers, budget, kitchen.clips[1]!] },
      complete: async ({ kind, user }) => {
        if (kind === 'synthesis') synthesis = user;
        if (kind === 'plan') {
          return {
            text: JSON.stringify({
              calls: [
                ...fillers.map((row) => ({ tool: 'get_clip', proofId: row.proofId })),
                { tool: 'get_clip', proofId: budget.proofId },
              ],
            }),
          };
        }
        if (kind === 'sufficiency') return { text: '{"sufficient":true,"covered":["visit"],"gaps":[]}' };
        return { text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08).' };
      },
    });
    assert.match(synthesis, /twelve thousand/);
    assert.match(synthesis, /Filler line 1-1/);
  });
});

test('a last-job comparison loads the other job when its transcript never says similar', async () => {
  await withoutModelKeys(async () => {
    const researched = await runAskResearch({
      question: 'How does this compare to the last job?',
      catalog: {
        ...kitchen,
        orgClips: [
          clip({
            proofId: '00000000-0000-4000-8000-00000000c202',
            jobId: '00000000-0000-4000-8000-00000000c302',
            title: 'Prior roof walkthrough',
            jobTitle: 'Prior roof',
            workDate: '2026-08-20',
            segments: [{ start: 3, end: 6, text: 'The shingles were thirty year.', speaker: 'SPEAKER_0' }],
          }),
        ],
      },
    });
    assert.match(researched.answer, /thirty year/);
    assert.match(researched.answer, /Prior roof walkthrough/);
    assert.match(researched.answer, /twelve thousand/);
    assert.doesNotMatch(researched.answer, /No other job in this organization is loaded/);
  });
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

test('a slow plan aborts inside the budget when the scratchpad is still empty', async () => {
  const wall = Date.now();
  await assert.rejects(
    () =>
      runAskResearch({
        question: 'compare the two visits',
        catalog: kitchen,
        budgetMs: 80,
        synthesisReserveMs: 40,
        complete: ({ signal }) => hang(signal, 5_000),
      }),
    /research_deadline/,
  );
  const elapsed = Date.now() - wall;
  assert.ok(elapsed < 1_000, `elapsed ${elapsed}`);
});

test('a step that starts just before the deadline aborts and synthesizes the scratchpad', async () => {
  const budgetMs = 20_000;
  let virtual = 0;
  const realStart = Date.now();
  let plans = 0;
  const wall = Date.now();
  const researched = await runAskResearch({
    question: 'List every time the homeowner mentioned budget across clips.',
    catalog: kitchen,
    budgetMs,
    synthesisReserveMs: 5_000,
    now: () => virtual + (Date.now() - realStart),
    complete: async ({ kind, signal }) => {
      if (kind === 'plan') {
        plans += 1;
        if (plans > 1) return hang(signal, 5_000);
        return { text: '{"calls":[{"tool":"search_transcripts","query":"budget"}]}' };
      }
      if (kind === 'sufficiency') {
        virtual = budgetMs - 200;
        return { text: '{"sufficient":false,"covered":[],"gaps":["more"]}' };
      }
      return { text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08).' };
    },
  });
  const elapsed = Date.now() - wall;
  assert.equal(researched.meta.stopReason, 'budget');
  assert.equal(plans, 2);
  assert.match(researched.answer, /twelve thousand/);
  assert.ok(elapsed < 1_000, `elapsed ${elapsed}`);
});

test('a slow tool that starts just before the deadline aborts and keeps earlier evidence', async () => {
  const budgetMs = 20_000;
  let virtual = 0;
  const realStart = Date.now();
  let tools = 0;
  const wall = Date.now();
  const researched = await runAskResearch({
    question: 'List every time the homeowner mentioned budget across clips.',
    catalog: kitchen,
    budgetMs,
    synthesisReserveMs: 5_000,
    now: () => virtual + (Date.now() - realStart),
    callTool: async (_call, signal) => {
      tools += 1;
      if (tools > 1) return hang(signal, 5_000);
      return {
        step: {
          tool: 'search_transcripts',
          input: { query: 'budget' },
          result: { ok: true, tool: 'search_transcripts', summary: '1 transcript moment.' },
        },
        records: [
          {
            id: 'chunk-budget',
            kind: 'chunk',
            proofId: kitchen.clips[0]!.proofId,
            jobId: JOB,
            clipTitle: 'First kitchen visit',
            startSec: 8,
            speaker: 'SPEAKER_0',
            text: 'The budget is twelve thousand.',
            cite: null,
          },
        ],
      };
    },
    complete: async ({ kind }) => {
      if (kind === 'plan') {
        return { text: `{"calls":[{"tool":"search_transcripts","query":"budget ${tools + 1}"}]}` };
      }
      if (kind === 'sufficiency') {
        virtual = budgetMs - 200;
        return { text: '{"sufficient":false,"covered":[],"gaps":["more"]}' };
      }
      return { text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08).' };
    },
  });
  const elapsed = Date.now() - wall;
  assert.equal(researched.meta.stopReason, 'budget');
  assert.equal(tools, 2);
  assert.match(researched.answer, /twelve thousand/);
  assert.ok(elapsed < 1_000, `elapsed ${elapsed}`);
});

test('synthesis that overruns the reserve uses the scratchpad answer', async () => {
  let virtual = 0;
  const realStart = Date.now();
  const wall = Date.now();
  const researched = await runAskResearch({
    question: 'What changed between the first and last visit?',
    catalog: kitchen,
    budgetMs: 1_000,
    synthesisReserveMs: 80,
    now: () => virtual + (Date.now() - realStart),
    complete: async ({ kind, signal }) => {
      if (kind === 'plan') {
        return {
          text: '{"calls":[{"tool":"get_clip","proofId":"00000000-0000-4000-8000-00000000c101"},{"tool":"get_clip","proofId":"00000000-0000-4000-8000-00000000c102"}]}',
        };
      }
      if (kind === 'sufficiency') {
        virtual = 1_000;
        return { text: '{"sufficient":true,"covered":["visits"],"gaps":[]}' };
      }
      return hang(signal, 5_000);
    },
  });
  const elapsed = Date.now() - wall;
  assert.equal(researched.meta.stopReason, 'sufficient');
  assert.match(researched.answer, /twelve thousand/);
  assert.match(researched.answer, /fifteen thousand/);
  assert.ok(elapsed < 1_000, `elapsed ${elapsed}`);
});

test('an empty scratchpad at the deadline falls back to the single pass', async () => {
  await withoutModelKeys(async () => {
    let stepped = false;
    const wall = Date.now();
    const looked = await answerFromAskLookup({
      question: 'compare the two visits',
      catalog: kitchen,
      step: async () => {
        stepped = true;
        return null;
      },
      research: {
        budgetMs: 80,
        synthesisReserveMs: 40,
        complete: ({ signal }) => hang(signal, 5_000),
      },
    });
    const elapsed = Date.now() - wall;
    assert.equal(stepped, true);
    assert.equal(looked.research?.stopReason, 'fallback');
    assert.match(looked.answer, /Visit/);
    assert.ok(elapsed < 1_000, `elapsed ${elapsed}`);
  });
});

test('a deadline with evidence does not start a second full pass', async () => {
  await withoutModelKeys(async () => {
    const budgetMs = 20_000;
    let virtual = 0;
    const realStart = Date.now();
    let stepped = false;
    let plans = 0;
    const looked = await answerFromAskLookup({
      question: 'List every time the homeowner mentioned budget across clips.',
      catalog: kitchen,
      step: async () => {
        stepped = true;
        return { model: 'single', text: 'SINGLE PASS', calls: [] };
      },
      research: {
        budgetMs,
        synthesisReserveMs: 5_000,
        now: () => virtual + (Date.now() - realStart),
        complete: async ({ kind, signal }) => {
          if (kind === 'plan') {
            plans += 1;
            if (plans > 1) return hang(signal, 5_000);
            return { text: '{"calls":[{"tool":"search_transcripts","query":"budget"}]}' };
          }
          if (kind === 'sufficiency') {
            virtual = budgetMs - 200;
            return { text: '{"sufficient":false,"covered":[],"gaps":["more"]}' };
          }
          return { text: 'Speaker 1 said “The budget is twelve thousand.” (First kitchen visit, 0:08).' };
        },
      },
    });
    assert.equal(stepped, false);
    assert.equal(plans, 2);
    assert.equal(looked.research?.stopReason, 'budget');
    assert.match(looked.answer, /twelve thousand/);
    assert.doesNotMatch(looked.answer, /SINGLE PASS/);
  });
});

test('lookup fallback does not start a turn after the original ask deadline', async () => {
  let fetched = 0;
  const step = providerLookupStep({
    route: 'deep',
    anthropicApiKey: 'sk-test',
    deadlineAt: Date.now() - 10,
    fetchFn: async () => {
      fetched += 1;
      return new Response('no', { status: 500 });
    },
  });
  const turn = await step({ system: 'sys', stable: 'stable', user: 'user', trace: [] });
  assert.equal(turn, null);
  assert.equal(fetched, 0);
  assert.equal(askLookupDeadlineAt(1_000, 'deep', 32_000), 33_000);
  assert.equal(askLookupDeadlineAt(1_000, 'fast', 32_000), 19_000);
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
