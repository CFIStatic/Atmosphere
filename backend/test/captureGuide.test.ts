import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptureGuide, type GuideScopeItem } from '../src/shared/captureGuide.js';

/**
 * The shot list. The ordering rules are the product: anchor first always,
 * exclusions filmed untouched, proposed work never mentioned.
 */

const scope: GuideScopeItem[] = [
  { title: 'Strip north slope to decking', state: 'approved' },
  { title: 'Install synthetic underlayment', state: 'included' },
  { title: 'Replace damaged decking', state: 'proposed' },
  { title: 'Repaint the soffits', state: 'declined' },
  { title: 'Touch the skylights', state: 'excluded', reason: 'Owner is handling them' },
];

test('the anchor is always first and always about the exterior', () => {
  for (const phase of ['before', 'after'] as const) {
    const guide = buildCaptureGuide({ phase, scope });
    assert.equal(guide.steps[0].kind, 'anchor');
    assert.match(guide.steps[0].instruction, /Start outside, facing the front/);
    assert.match(guide.steps[0].why, /prove this footage is this site/i);
  }
});

test('work steps cover included and approved lines, in order, and nothing else', () => {
  const guide = buildCaptureGuide({ phase: 'before', scope });
  const work = guide.steps.filter((s) => s.kind === 'scope');
  assert.equal(work.length, 2);
  assert.match(work[0].instruction, /Strip north slope/);
  assert.match(work[1].instruction, /underlayment/);
  // A proposed line is not cleared to start; a guide that names it reads as
  // permission. A declined line is dead.
  const all = guide.steps.map((s) => s.instruction).join(' ');
  assert.ok(!all.includes('Replace damaged decking'));
  assert.ok(!all.includes('Repaint the soffits'));
});

test('exclusions are filmed untouched, with the reason carried along', () => {
  const guide = buildCaptureGuide({ phase: 'after', scope });
  const exclusions = guide.steps.filter((s) => s.kind === 'exclusion');
  assert.equal(exclusions.length, 1);
  assert.match(exclusions[0].instruction, /untouched/);
  assert.match(exclusions[0].instruction, /Owner is handling them/);
  assert.match(exclusions[0].why, /timestamped pan/);
});

test('the wording follows the phase', () => {
  const before = buildCaptureGuide({ phase: 'before', scope });
  const after = buildCaptureGuide({ phase: 'after', scope });
  assert.match(before.steps.find((s) => s.kind === 'scope')!.instruction, /before touching it/);
  assert.match(after.steps.find((s) => s.kind === 'scope')!.instruction, /finished state/);
  assert.match(before.steps.at(-1)!.instruction, /anything unexpected/);
  assert.match(after.steps.at(-1)!.instruction, /meter or reading/);
});

test('an empty scope still yields anchor and wrap — never an empty guide', () => {
  const guide = buildCaptureGuide({ phase: 'before', scope: [] });
  assert.deepEqual(
    guide.steps.map((s) => s.kind),
    ['anchor', 'wrap'],
  );
  assert.ok(guide.targetSeconds >= 45);
});

test('target seconds grow with the work and stay inside honest bounds', () => {
  const small = buildCaptureGuide({ phase: 'before', scope: [] }).targetSeconds;
  const mid = buildCaptureGuide({ phase: 'before', scope }).targetSeconds;
  const bigScope: GuideScopeItem[] = Array.from({ length: 40 }, (_, i) => ({
    title: `Area ${i}`,
    state: 'included',
  }));
  const big = buildCaptureGuide({ phase: 'before', scope: bigScope }).targetSeconds;
  assert.ok(small < mid && mid < big);
  assert.ok(small >= 45);
  assert.equal(big, 300, 'capped — nobody films or watches more');
});

test('every step states its why — an instruction without a reason gets ignored on a job site', () => {
  const guide = buildCaptureGuide({ phase: 'before', scope });
  for (const step of guide.steps) {
    assert.ok(step.why.length > 20, `${step.kind} step has no real why`);
  }
});
