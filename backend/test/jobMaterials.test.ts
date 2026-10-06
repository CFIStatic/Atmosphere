import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJobMaterials,
  formatMaterialsListForChat,
  looksLikeMaterialsListAsk,
  materialsRowsForUi,
  isPlausibleSpec,
  specForItem,
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
  assert.match(md, /MATERIALS_JSON:/);
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

test('one source chip per clip, keeping the moment that names the item', () => {
  const list = extractJobMaterials({
    clips: [
      {
        workDate: '2026-10-04',
        proofId: 'cedca9e4-5f44-4094-bd03-e4289f44e183',
        summary: 'Laminate countertop measured on the bench.',
        transcript: '[0:00] The countertop is not on yet.\n[0:08] Measuring the laminate countertop. 61 and a half inches.',
      },
    ],
  } as never);
  const rows = materialsRowsForUi(list, { jobId: '058b09a8-3ca0-4d29-b554-4c54de26dea5' });
  const lam = rows.find((r) => r.item === 'laminate countertop');
  assert.ok(lam);
  assert.equal(lam!.sources.length, 1);
  assert.equal(lam!.sources[0].atSeconds, 8);
  assert.match(lam!.sources[0].label, /0:08/);
});

/* -------------------------------------------------- spec is an attribute -- */

test('regression: "colored packaging behind" never becomes a spec (Sample Job 058b09a8 case)', () => {
  // Paraphrase of the Sample Job narration that produced "ed packaging behind"
  // on birch plywood, construction adhesive and flooring.
  const narration =
    'Crew sets an unfinished birch plywood carcass on the bench. Someone runs a bead of adhesive along the edge before clamping. ' +
    'Off to one side there is a shipping carton or colored packaging behind the saw. ' +
    'Underfoot is new plank flooring, trim not yet on.';
  const list = extractJobMaterials(
    { job: { id: 'j' }, facts: {}, scope: [], documents: [], clips: [{ workDate: '2026-10-04', proofId: 'p', narration, transcript: '', concerns: [], changes: [] }] } as never,
    null,
  );
  const byItem = new Map(list.items.map((i) => [i.item, i]));
  for (const name of ['birch plywood', 'construction adhesive', 'flooring']) {
    assert.ok(byItem.has(name), `${name} is still listed`);
    assert.equal(byItem.get(name)!.spec, null, `${name} has no spec`);
  }
  assert.ok(list.items.every((i) => !/packaging|behind/i.test(i.spec ?? '')));
});

test('isPlausibleSpec accepts attributes and rejects fragments', () => {
  for (const ok of ['3/4 in.', '4 ft x 8 ft', '2-1/4"', '30 x 24 in.', 'Weathered Wood', 'Brite White', 'A-grade', 'grade B']) {
    assert.equal(isPlausibleSpec(ok), true, ok);
  }
  for (const bad of ['ed packaging behind', 'packaging behind', 'the corner pieces', 'is visible at left', 'or glue', '', null, 'A Very Long Name That Keeps Going On And On']) {
    assert.equal(isPlausibleSpec(bad), false, String(bad));
  }
});

test('specForItem only reads attributes tied to that item', () => {
  assert.equal(specForItem('birch plywood', 'Two sheets of 3/4 in. birch plywood for the boxes.'), '3/4 in.');
  assert.equal(specForItem('laminate countertop', 'Laminate countertop, color: Brite White, matte.'), 'Brite White');
  assert.equal(specForItem('architectural shingles', 'Architectural shingles in weathered wood on the main roof.'), 'Weathered Wood');
  // Quantity, not size.
  assert.equal(specForItem('crown molding', 'We need 20 ft of crown molding.'), null);
  // Attribute in a different sentence belongs to something else.
  assert.equal(specForItem('flooring', 'The trim is 3/4 in. thick. Flooring goes in tomorrow.'), null);
  // "colored" is not "color:".
  assert.equal(specForItem('flooring', 'Flooring box with colored packaging behind it.'), null);
});
