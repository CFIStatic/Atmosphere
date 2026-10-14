/**
 * The new single-agent job Chat: one model, the whole job file cached once per
 * job, every tool, a real tool loop. Approval cards and the quote check stay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import {
  agentJobContext,
  agentModels,
  askAgentEnabled,
  runAskAgent,
  warmAskAgent,
  type AskAgentModelCall,
  type AskAgentWarmCall,
} from '../src/shared/askAgent.js';
import { askModelActionTools } from '../src/shared/askTools.js';
import { answerFromJobFile } from '../src/shared/jobFileAsk.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const PROOF = '11111111-2222-4333-8444-555555555555';

function catalog(): AskLookupCatalog {
  return {
    orgId: ORG,
    jobId: JOB,
    access: 'org',
    jobTitle: 'Von Mour basement',
    jobAddress: '12 Elm St, Milwaukee, WI',
    clientName: 'Pat Test',
    timeZone: 'America/Chicago',
    clips: [
      {
        proofId: PROOF,
        jobId: JOB,
        orgId: ORG,
        title: 'Basement walkthrough',
        workDate: '2026-10-10',
        transcript: 'Speaker 1: The carpet pad is soaked along the north wall.\nSpeaker 2: We need two dehumidifiers down here.',
      },
    ],
    history: [],
    people: [],
  };
}

type Scripted = Array<{ text?: string; tools?: Array<{ name: string; input: Record<string, unknown> }> }>;

function scripted(turns: Scripted, seen: Parameters<AskAgentModelCall>[0][] = []): AskAgentModelCall {
  let i = 0;
  return async (req) => {
    seen.push(structuredClone({ ...req, signal: undefined, onText: undefined }) as never);
    const turn = turns[Math.min(i, turns.length - 1)]!;
    i += 1;
    const blocks: Anthropic.ContentBlock[] = [];
    if (turn.text) {
      req.onText(turn.text);
      blocks.push({ type: 'text', text: turn.text, citations: null } as Anthropic.TextBlock);
    }
    for (const [n, call] of (turn.tools ?? []).entries()) {
      blocks.push({ type: 'tool_use', id: `tu_${i}_${n}`, name: call.name, input: call.input } as Anthropic.ToolUseBlock);
    }
    return { model: req.model, blocks, usage: null };
  };
}

test('the switch: on for everyone by default (classic only when a turn asks), beta, off', () => {
  const prev = process.env.ASK_AGENT;
  try {
    delete process.env.ASK_AGENT;
    assert.equal(askAgentEnabled(undefined), true);
    assert.equal(askAgentEnabled('classic'), false);
    process.env.ASK_AGENT = 'beta';
    assert.equal(askAgentEnabled(undefined), false);
    assert.equal(askAgentEnabled('agent'), true);
    process.env.ASK_AGENT = 'off';
    assert.equal(askAgentEnabled('agent'), false);
  } finally {
    if (prev === undefined) delete process.env.ASK_AGENT;
    else process.env.ASK_AGENT = prev;
  }
});

test('the cached job file has every clip with its cite and transcript, and nothing question-specific', () => {
  const ctx = agentJobContext(catalog(), 'Brief: lockbox on side door');
  assert.match(ctx, /Von Mour basement/);
  assert.match(ctx, new RegExp(`video/${JOB}/${PROOF}/`));
  assert.match(ctx, /carpet pad is soaked/);
  assert.match(ctx, /lockbox on side door/);
  // Same input, same text: the prompt cache matches across questions.
  assert.equal(ctx, agentJobContext(catalog(), 'Brief: lockbox on side door'));
});

test('every turn starts on the fast model; the model hands itself to the deep model with think_harder', async () => {
  const prev = { fast: process.env.ASK_AGENT_MODEL, deep: process.env.ASK_AGENT_DEEP_MODEL };
  process.env.ASK_AGENT_MODEL = 'fast-test-model';
  process.env.ASK_AGENT_DEEP_MODEL = 'deep-test-model';
  try {
    assert.deepEqual(agentModels(), { fast: 'fast-test-model', deep: 'deep-test-model' });
    const seen: Parameters<AskAgentModelCall>[0][] = [];
    const quick = await runAskAgent({
      question: 'what did they say about the carpet pad?',
      catalog: catalog(),
      callModel: scripted([{ text: 'The carpet pad is soaked along the north wall.' }], seen),
    });
    assert.equal(seen[0]!.model, 'fast-test-model');
    assert.ok(seen[0]!.tools.some((t) => t.name === 'think_harder'));
    assert.equal(quick.escalated, false);

    const deepSeen: Parameters<AskAgentModelCall>[0][] = [];
    const deep = await runAskAgent({
      question: 'draft the supplement request for the adjuster',
      catalog: catalog(),
      callModel: scripted(
        [
          { tools: [{ name: 'search_transcripts', input: { query: 'dehumidifiers' } }, { name: 'think_harder', input: { reason: 'draft to adjuster' } }] },
          { text: 'Here is the draft.' },
        ],
        deepSeen,
      ),
    });
    assert.equal(deep.escalated, true);
    assert.deepEqual(deepSeen.map((r) => r.model), ['fast-test-model', 'deep-test-model']);
    // The deep model starts the turn over (no half-finished tool exchange), without the escalation tool,
    // and with what was already looked up.
    assert.ok(!deepSeen[1]!.tools.some((t) => t.name === 'think_harder'));
    assert.equal(deepSeen[1]!.messages.length, 1);
    assert.match(String(deepSeen[1]!.messages[0]!.content), /Looked up so far this turn/);
    assert.match(deep.answer, /Here is the draft/);
  } finally {
    for (const [k, v] of [['ASK_AGENT_MODEL', prev.fast], ['ASK_AGENT_DEEP_MODEL', prev.deep]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('one turn: job file and question go to the model, the system prompt is cached, the answer streams', async () => {
  const seen: Parameters<AskAgentModelCall>[0][] = [];
  const streamed: string[] = [];
  const result = await runAskAgent({
    question: 'what is wrong in the basement?',
    catalog: catalog(),
    history: [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'Hi! What do you need on this job?' },
    ],
    onToken: (t) => streamed.push(t),
    callModel: scripted(
      [{ text: `The carpet pad is soaked along the north wall.\n\n⟦sources: video/${JOB}/${PROOF}/basement-walkthrough, video/${JOB}/99999999-2222-4333-8444-555555555555/fake⟧` }],
      seen,
    ),
  });
  assert.equal(seen.length, 1);
  const req = seen[0]!;
  assert.equal(req.system.length, 2);
  assert.ok(req.system.every((b) => b.cache_control));
  assert.match(String(req.system[1]!.text), /carpet pad is soaked/);
  assert.doesNotMatch(String(req.system[1]!.text), /what is wrong in the basement/);
  // Real multi-turn history, ending on the new question.
  assert.deepEqual(req.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(String(req.messages[2]!.content), /what is wrong in the basement\?$/);
  assert.ok(streamed.join('').startsWith('The carpet pad'));
  // A source that is not a clip on this job is dropped.
  assert.match(result.answer, new RegExp(PROOF));
  assert.doesNotMatch(result.answer, /99999999/);
});

test('tool loop: the model looks something up, then answers; a made-up quote does not survive', async () => {
  const result = await runAskAgent({
    question: 'what did they say about dehumidifiers?',
    catalog: catalog(),
    callModel: scripted([
      { text: 'Let me check.', tools: [{ name: 'search_transcripts', input: { query: 'dehumidifiers' } }] },
      { text: 'They asked for “two dehumidifiers and a fan in every room.” (Basement walkthrough, 0:05)' },
    ]),
  });
  assert.equal(result.trace[0]?.tool, 'search_transcripts');
  assert.doesNotMatch(result.answer, /a fan in every room/);
});

test('a command runs the action tool, and a site command hands the turn to Computer', async () => {
  const ran: string[] = [];
  const texted = await runAskAgent({
    question: 'let Pat know we will be there at 3',
    catalog: catalog(),
    actions: {
      tools: askModelActionTools('org'),
      run: async (name) => {
        ran.push(name);
        return { ok: true, tool: name, summary: 'Card ready. Nothing has been sent.' };
      },
    },
    callModel: scripted([
      { tools: [{ name: 'send_job_sms', input: { to: '4145550100', body: 'We will be there at 3.', recipient: 'Pat' } }] },
      { text: 'The text to Pat is ready. Press Send when it looks right.' },
    ]),
  });
  assert.deepEqual(ran, ['send_job_sms']);
  assert.match(texted.answer, /ready/);

  let instructions = '';
  const site = await runAskAgent({
    question: 'log in to restore 365 and list active jobs',
    catalog: catalog(),
    computer: async (args) => {
      instructions = args.instructions;
      return 'Opening Restore 365 now.\n\n⟦actions: start_computer_task|Started|computer|computer-task:t1⟧';
    },
    callModel: scripted([
      { tools: [{ name: 'start_computer_task', input: { instructions: 'Sign in to Restore 365 and list active jobs' } }] },
    ]),
  });
  assert.equal(site.computerStarted, true);
  assert.equal(instructions, 'Sign in to Restore 365 and list active jobs');
  assert.match(site.answer, /computer-task:t1/);
});

test('answerFromJobFile uses the agent only when the turn asks for it', async () => {
  const prev = process.env.ASK_AGENT;
  delete process.env.ASK_AGENT;
  try {
    const base = {
      question: 'what is the drying goal for carpet pad like this?',
      file: { job: { id: JOB, title: 'Von Mour basement' } },
      lookup: catalog(),
      apiKey: 'test-key',
      agentCall: scripted([{ text: 'General guidance: dry the pad to match an unaffected reference area; this file does not list readings.' }]),
    };
    const agent = await answerFromJobFile({ ...base, engine: 'agent' });
    assert.equal(agent.agent, true);
    assert.match(agent.answer, /General guidance/);
  } finally {
    if (prev === undefined) delete process.env.ASK_AGENT;
    else process.env.ASK_AGENT = prev;
  }
});

test('look_at_clip: the model gets stills as images, only for clips this person can see', async () => {
  const seen: Parameters<AskAgentModelCall>[0][] = [];
  const asked: Array<{ proofId: string; at: number | null; count: number }> = [];
  const result = await runAskAgent({
    question: 'what does the ceiling look like in the walkthrough?',
    catalog: catalog(),
    clipStills: async (clip, opts) => {
      asked.push({ proofId: clip.proofId, at: opts.atSeconds, count: opts.count });
      return { stills: [{ atSeconds: 12, jpeg: Buffer.from('fake-jpeg') }], onFile: 3, privateSkipped: 1 };
    },
    callModel: scripted(
      [
        {
          tools: [
            { name: 'look_at_clip', input: { proofId: PROOF, atSeconds: 10 } },
            { name: 'look_at_clip', input: { proofId: '99999999-2222-4333-8444-555555555555' } },
          ],
        },
        { text: 'The ceiling drywall is stained near the laundry wall.' },
      ],
      seen,
    ),
  });
  assert.ok(seen[0]!.tools.some((t) => t.name === 'look_at_clip'));
  // Only the clip on this job was loaded.
  assert.deepEqual(asked, [{ proofId: PROOF, at: 10, count: 3 }]);
  const results = seen[1]!.messages.at(-1)!.content as Array<{ content: unknown; is_error?: boolean }>;
  const looked = results[0]!.content as Array<{ type: string; source?: { data: string } }>;
  assert.equal(looked[0]!.type, 'text');
  assert.match(String((looked[0] as { text?: string }).text), /1 private moment/);
  assert.equal(looked[1]!.type, 'image');
  assert.equal(looked[1]!.source!.data, Buffer.from('fake-jpeg').toString('base64'));
  assert.equal(results[1]!.is_error, true);
  // The trace keeps no image bytes.
  assert.doesNotMatch(JSON.stringify(result.trace), /ZmFrZS1qcGVn/);
  assert.match(result.answer, /stained/);
});

test('other jobs load only when the model searches them, and only for office users', async () => {
  let loads = 0;
  const other = { ...catalog().clips[0]!, proofId: '77777777-2222-4333-8444-555555555555', jobId: '88888888-2222-4333-8444-555555555555', jobTitle: 'Lopez Kitchen', title: 'Lopez walkthrough' };
  const run = (question: string, access: 'org' | 'viewer', tools: Array<{ name: string; input: Record<string, unknown> }>) =>
    runAskAgent({
      question,
      catalog: { ...catalog(), access },
      loadOrgClips: async () => {
        loads += 1;
        return [other];
      },
      callModel: scripted(tools.length ? [{ tools }, { text: 'Done.' }] : [{ text: 'Done.' }]),
    });
  await run('what is the claim number?', 'org', []);
  assert.equal(loads, 0);
  const office = await run('which other jobs had wet drywall?', 'org', [{ name: 'search_other_jobs', input: { query: 'drywall' } }]);
  assert.equal(loads, 1);
  assert.match(office.trace[0]!.result.summary, /other jobs/);
  await run('which other jobs had wet drywall?', 'viewer', [{ name: 'search_other_jobs', input: { query: 'drywall' } }]);
  assert.equal(loads, 1);
});

test('warm: while the person types, the job file goes into the cache with exactly what the first round sends', async () => {
  const warms: Parameters<AskAgentWarmCall>[0][] = [];
  const warmCall: AskAgentWarmCall = async (req) => {
    warms.push(structuredClone(req));
    return null;
  };
  const seen: Parameters<AskAgentModelCall>[0][] = [];
  const shared = {
    catalog: catalog(),
    jobFileRecord: 'Brief note\nLockbox on the side door.',
    actions: { tools: askModelActionTools('org'), run: async () => ({ ok: true, tool: 'x', summary: '' }) },
    clipStills: async () => ({ stills: [], onFile: 0, privateSkipped: 0 }),
  };
  const warmed = await warmAskAgent({ ...shared, question: '', warmCall });
  assert.ok(warmed);
  await runAskAgent({
    ...shared,
    question: 'where is the lockbox?',
    turnContext: 'Thread memory: none',
    callModel: scripted([{ text: 'On the side door.' }], seen),
  });
  assert.equal(warms.length, 1);
  const first = seen[0]!;
  assert.equal(warms[0]!.model, first.model);
  assert.deepEqual(warms[0]!.system, first.system);
  assert.deepEqual(warms[0]!.tools, first.tools);
  // The first round sends no thinking settings, so the warm needs none either.
  assert.equal(first.thinking, undefined);
  assert.equal(first.outputConfig, undefined);
});

test('warm through answerFromJobFile answers nothing and never calls the answering model', async () => {
  const prev = process.env.ASK_AGENT;
  delete process.env.ASK_AGENT;
  try {
    let warmed = 0;
    const out = await answerFromJobFile({
      question: '',
      file: { job: { id: JOB, title: 'Von Mour basement' } },
      lookup: catalog(),
      apiKey: 'test-key',
      warmOnly: true,
      agentWarmCall: async () => {
        warmed += 1;
        return null;
      },
      agentCall: async () => {
        throw new Error('the warm must not answer');
      },
    });
    assert.equal(warmed, 1);
    assert.equal(out.answer, '');
    const classic = await answerFromJobFile({
      question: '',
      file: { job: { id: JOB, title: 'Von Mour basement' } },
      lookup: catalog(),
      apiKey: 'test-key',
      engine: 'classic',
      warmOnly: true,
      agentWarmCall: async () => {
        warmed += 1;
        return null;
      },
    });
    assert.equal(classic.answer, '');
    assert.equal(warmed, 1);
  } finally {
    if (prev === undefined) delete process.env.ASK_AGENT;
    else process.env.ASK_AGENT = prev;
  }
});
