import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOrgMemoryCandidates,
  filterOrgMemoryForAccess,
  formatOrgMemoryForPrompt,
  type OrgMemoryFact,
} from '../src/shared/askOrgMemory.js';

const ORG = '0a000000-0000-4000-8000-0000000000aa';
const JOB_A = '0a000000-0000-4000-8000-0000000000a1';
const JOB_B = '0a000000-0000-4000-8000-0000000000a2';

test('extractOrgMemoryCandidates: preference + adjuster + carrier', () => {
  const facts = extractOrgMemoryCandidates({
    orgId: ORG,
    jobId: JOB_A,
    question: 'Remember for the company: we usually send AccuLynx notes before calling.',
    answer: 'Noted. The adjuster is Sam Adjuster and the carrier is State Farm.',
    restrictedJob: false,
  });
  assert.ok(facts.some((f) => f.kind === 'preference'));
  assert.ok(facts.some((f) => f.kind === 'adjuster' && f.restricted));
  assert.ok(facts.some((f) => f.kind === 'carrier' && /State Farm/i.test(f.label)));
});

test('filterOrgMemoryForAccess: restricted facts need every source job', () => {
  const facts: OrgMemoryFact[] = [
    {
      orgId: ORG,
      kind: 'preference',
      label: 'notes first',
      detail: 'we usually send AccuLynx notes first',
      restricted: false,
      sourceJobIds: [JOB_A],
      confidence: 0.7,
    },
    {
      orgId: ORG,
      kind: 'adjuster',
      label: 'Sam',
      detail: 'Adjuster Sam',
      restricted: true,
      sourceJobIds: [JOB_A, JOB_B],
      confidence: 0.6,
    },
  ];
  const onlyA = filterOrgMemoryForAccess(facts, new Set([JOB_A]));
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0]!.kind, 'preference');

  const both = filterOrgMemoryForAccess(facts, new Set([JOB_A, JOB_B]));
  assert.equal(both.length, 2);

  const failClosed = filterOrgMemoryForAccess(facts, null);
  assert.equal(failClosed.length, 1);
  assert.equal(failClosed[0]!.restricted, false);
});

test('formatOrgMemoryForPrompt lists kinds without dumping empty', () => {
  assert.equal(formatOrgMemoryForPrompt([]), '');
  const text = formatOrgMemoryForPrompt([
    {
      orgId: ORG,
      kind: 'pricing',
      label: 'roof squares',
      detail: 'price roof by square with waste factor 10%',
      restricted: false,
      sourceJobIds: [],
      confidence: 0.8,
    },
  ]);
  assert.match(text, /Company memory/);
  assert.match(text, /\[pricing\] roof squares/);
});
