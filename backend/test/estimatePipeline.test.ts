import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMitigationEstimate } from '../src/estimator/estimate/mitigationImport.js';
import { deriveRebuildScope } from '../src/estimator/scope/rebuildFromMitigation.js';
import { buildScope } from '../src/estimator/scope/scopeBuilder.js';
import { buildEstimate, readinessIssues } from '../src/estimator/estimate/estimateBuilder.js';
import { toCsv, toXactimateXml } from '../src/estimator/estimate/export.js';
import { FIXTURES } from '../src/estimator/connectors/fixtures.js';
import { EMPTY_DIRECTIVES } from '../src/estimator/ai/noteAnalysis.js';
import type { DamageObservation } from '../src/estimator/types.js';

/**
 * The scope-and-price half of the pipeline, end to end, with no network and no
 * model: mitigation estimate in, priced construction estimate out. This is the
 * path a real rebuild takes, so it is the one worth pinning down.
 */

const job = FIXTURES.jobs[0]!;
const rooms = FIXTURES.project.rooms;

/** What the note reader produces from the fixture job's notes. */
const directives = {
  ...EMPTY_DIRECTIVES,
  summary: 'Cat 1 supply-line loss. 2 ft flood cut approved; office out of scope.',
  roomsOutOfScope: ['Office'],
  waterCategory: 1,
  floodCutHeightFt: 2,
  materialsByRoom: [{ room: 'Living Room', material: 'LVP' }],
};

function run(observations: DamageObservation[] = []) {
  const mitigation = parseMitigationEstimate(FIXTURES.mitigationCsv, {
    source: 'fixture',
    format: 'csv',
  });
  const derived = deriveRebuildScope(mitigation);
  const scope = buildScope({
    rooms,
    observations,
    directives,
    mitigationItems: derived.items,
  });
  return {
    scope,
    estimate: buildEstimate({
      job,
      rooms,
      scope: scope.items,
      basis: observations.length > 0 ? 'both' : 'mitigation',
      warnings: scope.warnings,
    }),
  };
}

describe('rebuild estimate from a mitigation estimate', () => {
  const { estimate } = run();
  const inRoom = (name: string) => estimate.lineItems.filter((line) => line.roomName === name);
  const line = (name: string, code: string) => inRoom(name).find((entry) => entry.code === code);

  it('scopes every room the mitigation crew worked in', () => {
    const scoped = new Set(estimate.lineItems.map((entry) => entry.roomName));
    assert.deepEqual([...scoped].sort(), ['Hallway', 'Living Room', 'Master Bedroom']);
  });

  it('honours the note that puts the office out of scope', () => {
    assert.equal(inRoom('Office').length, 0);
    assert.ok(estimate.warnings.some((warning) => /Office: excluded/.test(warning)));
  });

  it('re-hangs the flood-cut band, not the whole wall', () => {
    // 68 LF of 2 ft cut = 136 SF, plus the catalog's 10% drywall waste.
    assert.equal(line('Living Room', 'DRY 1/2-')?.quantity, 136);
    assert.equal(line('Living Room', 'DRY 1/2-')?.quantityWithWaste, 149.6);
  });

  it('paints the whole wall even though only a band was replaced', () => {
    // netWallArea(Living Room) = 544 − (20.01 + 35 + 20 + 20)
    assert.equal(line('Living Room', 'PNT SWL')?.quantity, 448.99);
  });

  it('replaces the flooring the mitigation crew pulled', () => {
    assert.equal(line('Living Room', 'FCV LVP')?.quantity, 288);
    assert.equal(line('Master Bedroom', 'FCC CP+')?.quantity, 224);
    assert.equal(line('Master Bedroom', 'FCC PAD')?.quantity, 224);
  });

  it('leaves dryout equipment, labour, and monitoring out entirely', () => {
    const text = JSON.stringify(estimate.lineItems);
    for (const token of ['Air mover', 'Dehumidifier', 'antimicrobial', 'technician', 'monitoring']) {
      assert.ok(!text.includes(token), `${token} leaked into the construction estimate`);
    }
  });

  it('adds cleanup and debris per scoped room, sized to what came out', () => {
    assert.equal(line('Living Room', 'CLN FC')?.quantity, 288);
    // 136 SF drywall + 288 SF LVP = 424 SF removed → two pickup loads.
    assert.equal(line('Living Room', 'DMO DUMP')?.quantity, 2);
  });

  it('orders the estimate room by room, in build order within a room', () => {
    const livingRoom = inRoom('Living Room').map((entry) => entry.trade);
    assert.ok(
      livingRoom.indexOf('Drywall') < livingRoom.indexOf('Painting'),
      'drywall should precede painting',
    );
    assert.ok(
      livingRoom.indexOf('Painting') < livingRoom.indexOf('Cleaning'),
      'cleaning should come last',
    );

    const roomOrder = [...new Set(estimate.lineItems.map((entry) => entry.roomName))];
    assert.deepEqual(roomOrder, ['Living Room', 'Hallway', 'Master Bedroom']);
  });

  it('is ready to export — no line is missing a quantity', () => {
    assert.deepEqual(readinessIssues(estimate), []);
  });

  it('summarises what a reviewer needs to check', () => {
    assert.equal(estimate.summary.roomCount, 3);
    assert.ok(estimate.summary.lineItemCount > 15);
    assert.deepEqual(estimate.summary.emptyRooms, ['Office']);
  });
});

describe('merging photo findings with the mitigation estimate', () => {
  const observations: DamageObservation[] = [
    {
      sourcePhotoId: 'photo-3',
      roomId: 'room-master',
      surface: 'floor',
      damageType: 'demolition',
      severity: 'heavy',
      confidence: 0.92,
      note: 'Carpet and pad already removed; subfloor visible and stained.',
      material: 'carpet',
    },
  ];

  const { estimate } = run(observations);
  const master = estimate.lineItems.filter((line) => line.roomName === 'Master Bedroom');

  it('does not double-scope work both sources found', () => {
    assert.equal(master.filter((line) => line.code === 'FCC CP+').length, 1);
  });

  it('keeps evidence from both sources on the merged line', () => {
    const carpet = master.find((line) => line.code === 'FCC CP+');
    assert.ok(carpet);
    assert.ok(carpet.evidence.some((entry) => entry === 'photo-3'));
    assert.ok(carpet.evidence.some((entry) => entry.startsWith('mitigation:')));
  });

  it('adds what only the photo could see', () => {
    // Heavy floor damage reaches the substrate; the mitigation lines did not
    // mention subfloor at all.
    assert.ok(master.some((line) => line.code === 'FRM SUBF'));
  });
});

describe('export', () => {
  const { estimate } = run();

  it('writes valid, escaped XML with the evidence attached', () => {
    const xml = toXactimateXml(estimate);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<Room id="room-living" name="Living Room">/);
    assert.match(xml, /<LineItem category="DRY" selector="1\/2-"/);
    assert.match(xml, /<Rationale>/);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(xml), 'every ampersand should be escaped');
  });

  it('writes CSV with quoted cells so commas in descriptions survive', () => {
    const csv = toCsv(estimate);
    const [header] = csv.split('\n');
    assert.equal(header, '"Room","Category","Selector","Code","Description","Unit","Quantity","QuantityBeforeWaste","Trade","Confidence","NeedsReview","Rationale","Evidence"');
    assert.equal(csv.split('\n').filter(Boolean).length, estimate.lineItems.length + 1);
  });
});
