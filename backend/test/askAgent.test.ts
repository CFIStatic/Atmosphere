/**
 * The new single-agent job Chat: one model, the whole job file cached once per
 * job, every tool, a real tool loop. Approval cards and the quote check stay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import {
  agentJobContext,
  agentModelFor,
  askAgentEnabled,
  runAskAgent,
  type AskAgentModelCall,
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

test('the switch: beta by default (only turns that ask), on, off', () => {
  const prev = process.env.ASK_AGENT;
  try {
    delete process.env.ASK_AGENT;
    assert.equal(askAgentEnabled(undefined), false);
    assert.equal(askAgentEnabled('agent'), true);
    process.env.ASK_AGENT = 'on';
    assert.equal(askAgentEnabled(undefined), true);
    assert.equal(askAgentEnabled('classic'), false);
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

test('Sonnet by default, the deep model for drafts, money and summaries', () => {
  assert.equal(agentModelFor('what did they say about the carpet pad?').deep, false);
  assert.equal(agentModelFor('who won the packers game').deep, false);
  assert.equal(agentModelFor('summarize this job').deep, true);
  assert.equal(agentModelFor('draft an email to the adjuster').deep, true);
  assert.equal(agentModelFor('how much is the deductible').deep, true);
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
