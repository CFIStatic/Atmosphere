/**
 * find_frames: stills of a subject on given days, privacy ranges skipped,
 * both sides of a before/after, and only tool-returned stills in the answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { finalizeFramesTrailer, rankFrames, subjectTerms, type FrameWindow, type FrameRow } from '../src/shared/askFrameSearch.js';
import { runAskAgent, type AskAgentModelCall } from '../src/shared/askAgent.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const P20 = '11111111-2222-4333-8444-555555555520';
const P22 = '11111111-2222-4333-8444-555555555522';
const OTHER = '11111111-2222-4333-8444-555555555599';

function catalog(access: 'org' | 'viewer' = 'org'): AskLookupCatalog {
  return {
    orgId: ORG,
    jobId: JOB,
    access,
    timeZone: 'America/Chicago',
    clips: [
      {
        proofId: P20,
        jobId: JOB,
        orgId: ORG,
        title: 'Demo day walkthrough',
        workDate: '2026-10-20',
        privacyRedactions: [{ startSeconds: 100, endSeconds: 120 }],
      },
      { proofId: P22, jobId: JOB, orgId: ORG, title: 'Stairs rebuilt', workDate: '2026-10-22' },
      { proofId: OTHER, jobId: 'another-job', orgId: ORG, title: 'Other job stairs', workDate: '2026-10-20' },
    ],
  };
}

const windows: FrameWindow[] = [
  { proofId: P20, start: 30, end: 50, text: 'Stairwell', kind: 'room' },
  { proofId: P20, start: 100, end: 118, text: 'Treads on the staircase are soaked', kind: 'analysis' },
  { proofId: P20, start: 200, end: 210, text: 'Kitchen cabinets removed', kind: 'room' },
  { proofId: P22, start: 10, end: 25, text: 'New stair treads and risers installed', kind: 'analysis' },
  { proofId: OTHER, start: 0, end: 30, text: 'Stairs', kind: 'room' },
];
const frames: FrameRow[] = [
  ...[0, 40, 110, 205].map((at) => ({ proofId: P20, atSeconds: at, storagePath: `p20/${at}.jpg` })),
  ...[15].map((at) => ({ proofId: P22, atSeconds: at, storagePath: `p22/${at}.jpg` })),
  { proofId: OTHER, atSeconds: 10, storagePath: 'other/10.jpg' },
];

test('subject terms carry trade synonyms', () => {
  const terms = subjectTerms('the stairs');
  assert.ok(terms.includes('stair') && terms.includes('tread') && terms.includes('stairwell'));
});

test('stairs on one day: the stairwell still, never a private moment or another job', () => {
  const found = rankFrames({ catalog: catalog(), args: { subject: 'stairs', dates: ['2026-10-20'] }, windows, frames });
  assert.deepEqual(found.map((f) => [f.proofId, f.atSeconds]), [[P20, 40]]);
  assert.match(found[0]!.cite, new RegExp(`^video/${JOB}/${P20}/.+@40$`));
});

test('two dates: both sides of the before/after come back, oldest first', () => {
  const found = rankFrames({ catalog: catalog(), args: { subject: 'stairs', dates: ['2026-10-20', '2026-10-22'] }, windows, frames });
  assert.deepEqual(found.map((f) => f.workDate), ['2026-10-20', '2026-10-22']);
});

test('no match on that day: nothing', () => {
  assert.equal(rankFrames({ catalog: catalog(), args: { subject: 'roof', dates: ['2026-10-22'] }, windows, frames }).length, 0);
});

test('frames line: only stills a tool returned; filled in when the model forgot it', () => {
  const ok = `video/${JOB}/${P20}/demo@40`;
  const fake = `video/${JOB}/${P20}/demo@999`;
  assert.equal(finalizeFramesTrailer(`Here.\n\n⟦frames: ${ok}, ${fake}⟧`, [ok], [ok]), `Here.\n\n⟦frames: ${ok}⟧`);
  assert.equal(finalizeFramesTrailer('Here.\n\n⟦sources: x⟧', [ok], [ok]), `Here.\n\n⟦frames: ${ok}⟧\n\n⟦sources: x⟧`);
  assert.equal(finalizeFramesTrailer(`Here. ⟦frames: ${fake}⟧`, [], []), 'Here.');
});

test('agent: find_frames is offered, its stills are shown to the model and land in the answer', async () => {
  const seen: Array<Parameters<AskAgentModelCall>[0]> = [];
  let round = 0;
  const call: AskAgentModelCall = async (req) => {
    seen.push(req);
    round += 1;
    const blocks: Anthropic.ContentBlock[] =
      round === 1
        ? [{ type: 'tool_use', id: 'tu1', name: 'find_frames', input: { subject: 'stairs', dates: ['2026-10-20', '2026-10-22'] } } as Anthropic.ToolUseBlock]
        : [{ type: 'text', text: 'On Oct 20 the treads were soaked; by Oct 22 new treads are in.', citations: null } as Anthropic.TextBlock];
    return { model: req.model, blocks, usage: null };
  };
  const cat = catalog();
  const result = await runAskAgent({
    question: 'what changed on the stairs between the 20th and the 22nd?',
    catalog: cat,
    callModel: call,
    findFrames: async (args) => {
      const found = rankFrames({ catalog: cat, args, windows, frames });
      return { frames: found, jpegs: found.map(() => Buffer.from([0xff, 0xd8, 0xff])) };
    },
  });
  assert.ok(seen[0]!.tools.some((t) => t.name === 'find_frames'));
  const toolTurn = seen[1]!.messages.at(-1)!.content as Array<{ content: unknown }>;
  const content = toolTurn[0]!.content as Array<{ type: string }>;
  assert.equal(content.filter((b) => b.type === 'image').length, 2);
  assert.match(result.answer, /⟦frames: video\/.+@40, video\/.+@15⟧/);
});
