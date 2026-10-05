import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJobMaterials,
  formatMaterialsListForChat,
  looksLikeMaterialsListAsk,
} from '../src/shared/jobMaterials.js';

const FILE = {
  job: { title: 'Sample roof', claimNumber: 'CLM-58' },
  facts: { Address: '100 Demo St' },
  scope: [
    { title: 'Install architectural shingles', detail: '28 squares Weathered Wood', state: 'included' },
    { title: 'Drip edge', detail: '240 lf', state: 'included' },
    { title: 'Exclude spa remodel', detail: '', state: 'excluded' },
  ],
  clips: [
    {
      workDate: '2026-09-12',
      proofId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      summary: 'Crew staging bundles of architectural shingles on the south slope.',
      transcript: 'At [2:15] we still need 4 rolls of ice and water shield for the valleys.',
      concerns: [],
      changes: ['Installed synthetic underlayment on the garage'],
    },
  ],
  documents: [
    {
      filename: 'estimate.pdf',
      kind: 'estimate',
      attached: true,
      summary: 'Materials: 3 boxes of roofing nails, 12 sheets of plywood.',
    },
  ],
};

test('looksLikeMaterialsListAsk', () => {
  assert.equal(looksLikeMaterialsListAsk('list the materials for this job'), true);
  assert.equal(looksLikeMaterialsListAsk('what supplies do we need'), true);
  assert.equal(looksLikeMaterialsListAsk('order the materials from Home Depot'), false);
});

test('extractJobMaterials cites sources and does not invent quantities', () => {
  const list = extractJobMaterials(FILE, '100 Demo St');
  assert.ok(list.items.length >= 3);
  const shingles = list.items.find((i) => /shingle/i.test(i.item) && i.quantity != null);
  assert.ok(shingles);
  assert.equal(shingles!.quantity, 28);
  assert.match(String(shingles!.unit), /square/i);
  assert.ok(shingles!.citations.some((c) => /scope/i.test(c.label)));
  const ice = list.items.find((i) => /ice and water/i.test(i.item));
  assert.ok(ice);
  assert.equal(ice!.quantity, 4);
  assert.ok(ice!.citations.some((c) => c.kind === 'transcript'));
  // Spa remodel excluded from scope
  assert.equal(list.items.some((i) => /spa/i.test(i.item)), false);
  const md = formatMaterialsListForChat(list);
  assert.match(md, /Materials on this job file/);
  assert.match(md, /unknown|evidence/i);
});

test('unknown quantity when not in evidence', () => {
  const list = extractJobMaterials({
    clips: [
      {
        workDate: '2026-01-01',
        summary: 'They talked about needing ridge cap on the hips.',
      },
    ],
  });
  const ridge = list.items.find((i) => /ridge/i.test(i.item));
  assert.ok(ridge);
  assert.equal(ridge!.quantity, null);
});
