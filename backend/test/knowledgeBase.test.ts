import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expandDependents } from '../src/estimator/knowledge/dependents.js';
import {
  planForRoom,
  scrubbersForVolume,
  sizeConstructionEquipment,
  workDaysForDustyArea,
} from '../src/estimator/knowledge/equipment.js';
import { applyCodeRequirements } from '../src/estimator/knowledge/codes.js';
import { assessCompleteness } from '../src/estimator/knowledge/completeness.js';
import { codeFor } from '../src/estimator/pricing/catalog.js';
import { deriveRebuildScope } from '../src/estimator/scope/rebuildFromMitigation.js';
import { buildScope } from '../src/estimator/scope/scopeBuilder.js';
import { buildEstimate, readinessIssues } from '../src/estimator/estimate/estimateBuilder.js';
import { parseMitigationEstimate } from '../src/estimator/estimate/mitigationImport.js';
import { FIXTURES } from '../src/estimator/connectors/fixtures.js';
import { EMPTY_DIRECTIVES } from '../src/estimator/ai/noteAnalysis.js';
import type { RoomMeasurements, ScopeItem } from '../src/estimator/types.js';

const living = FIXTURES.project.rooms.find((room) => room.name === 'Living Room')!;
const master = FIXTURES.project.rooms.find((room) => room.name === 'Master Bedroom')!;

function item(
  room: RoomMeasurements,
  key: Parameters<typeof codeFor>[0],
  quantity: number,
  extras: Partial<ScopeItem> = {},
): ScopeItem {
  return {
    roomId: room.id,
    roomName: room.name,
    code: codeFor(key),
    description: key,
    unit: 'SF',
    quantity,
    rationale: 'test',
    confidence: 0.9,
    evidence: ['test'],
    ...extras,
  };
}

describe('dependent assemblies', () => {
  it('adds primer, corner bead, outlets, and switches when drywall is replaced', () => {
    const { items, added } = expandDependents(
      [item(living, 'drywall_half', 136), item(living, 'paint_walls', 449)],
      [living],
    );
    assert.ok(added > 0);
    const codes = items.map((entry) => entry.code);
    assert.ok(codes.includes(codeFor('drywall_primer')));
    assert.ok(codes.includes(codeFor('drywall_corner_bead')));
    assert.ok(codes.includes(codeFor('outlet_reset')));
    assert.ok(codes.includes(codeFor('switch_reset')));
    assert.ok(codes.includes(codeFor('cover_plate')));
    assert.ok(codes.includes(codeFor('mask_and_cover')));
  });

  it('completes the carpet system: pad, tack strip, binder bar, contents', () => {
    const { items } = expandDependents([item(master, 'carpet', 224)], [master]);
    const codes = items.map((entry) => entry.code);
    assert.ok(codes.includes(codeFor('carpet_pad')));
    assert.ok(codes.includes(codeFor('carpet_tack_strip')));
    assert.ok(codes.includes(codeFor('carpet_binder_bar')));
    assert.ok(codes.includes(codeFor('content_manipulation')));
  });

  it('completes LVP with underlayment, prep, transitions, and shoe molding', () => {
    const { items } = expandDependents([item(living, 'luxury_vinyl_plank', 288)], [living]);
    const codes = items.map((entry) => entry.code);
    assert.ok(codes.includes(codeFor('floor_underlayment')));
    assert.ok(codes.includes(codeFor('floor_prep')));
    assert.ok(codes.includes(codeFor('floor_transition')));
    assert.ok(codes.includes(codeFor('shoe_molding')));
  });

  it('does not invent a toilet reset outside bathrooms', () => {
    const { items } = expandDependents([item(living, 'luxury_vinyl_plank', 288)], [living]);
    assert.ok(!items.some((entry) => entry.code === codeFor('toilet_reset')));
  });

  it('is idempotent — running twice does not duplicate companions', () => {
    const first = expandDependents([item(living, 'drywall_half', 136)], [living]);
    const second = expandDependents(first.items, [living]);
    assert.equal(second.added, 0);
  });
});

describe('construction equipment sizing', () => {
  it('sizes scrubbers from room volume at 1 per 1,000 CF', () => {
    // Living room: 288 SF × 8 ft = 2,304 CF → 3 scrubbers
    assert.equal(scrubbersForVolume(2304), 3);
    assert.equal(scrubbersForVolume(500), 1);
  });

  it('sizes work days from dusty area', () => {
    assert.equal(workDaysForDustyArea(136), 1);
    assert.equal(workDaysForDustyArea(450), 3);
  });

  it('requires filter changes whenever scrubbers are required', () => {
    const plan = planForRoom(living, 136);
    assert.ok(plan.scrubbers >= 1);
    assert.equal(plan.filterChanges, Math.max(plan.scrubbers, plan.scrubberDays));

    const sized = sizeConstructionEquipment(
      [item(living, 'drywall_half', 136)],
      [living],
    );
    const scrubber = sized.items.find((entry) => entry.code === codeFor('hepa_air_scrubber'));
    const filters = sized.items.find((entry) => entry.code === codeFor('hepa_filter_change'));
    assert.ok(scrubber, 'expected HEPA scrubbers for dusty drywall work');
    assert.ok(filters, 'filters are mandatory when scrubbers are required');
    assert.ok(filters!.quantity >= scrubber!.quantity / Math.max(plan.days, 1));
    assert.ok(sized.items.some((entry) => entry.code === codeFor('containment_barrier')));
    assert.ok(sized.items.some((entry) => entry.code === codeFor('zip_pole_door')));
  });
});

describe('local code requirements', () => {
  it('adds permit + smoke/CO for California bedroom wall work', () => {
    const bedroom: RoomMeasurements = {
      ...master,
      roomType: 'bedroom',
    };
    const result = applyCodeRequirements(
      [
        item(bedroom, 'drywall_half', 250),
        item(bedroom, 'paint_walls', 400),
      ],
      {
        address: { state: 'CA', city: 'Oakland', street: '1 Main' },
        rooms: [bedroom, ...FIXTURES.project.rooms.filter((room) => room.id !== bedroom.id)],
        waterCategory: 1,
      },
    );
    assert.equal(result.jurisdiction, 'california');
    const codes = result.items.map((entry) => entry.code);
    assert.ok(codes.includes(codeFor('building_permit')));
    assert.ok(codes.includes(codeFor('inspection_fee')));
    assert.ok(codes.includes(codeFor('smoke_detector')));
    assert.ok(codes.includes(codeFor('co_detector')));
  });

  it('adds GFCI when wet-area walls are opened', () => {
    const bath: RoomMeasurements = {
      id: 'room-bath',
      name: 'Hall Bath',
      roomType: 'bathroom',
      floorAreaSqFt: 40,
      ceilingAreaSqFt: 40,
      wallAreaSqFt: 120,
      perimeterLf: 26,
      ceilingHeightFt: 8,
      openings: [],
    };
    const result = applyCodeRequirements([item(bath, 'drywall_half', 40)], {
      address: { state: 'TX' },
      rooms: [bath],
    });
    assert.ok(result.items.some((entry) => entry.code === codeFor('gfci_outlet')));
  });
});

describe('completeness review', () => {
  it('flags carpet without pad as critical', () => {
    const report = assessCompleteness({
      items: [item(master, 'carpet', 224)],
      rooms: [master],
    });
    assert.ok(report.criticalCount >= 1);
    assert.ok(report.issues.some((issue) => /Carpet without pad/.test(issue.message)));
  });

  it('flags scrubber without filters as critical', () => {
    const scrubber = item(living, 'hepa_air_scrubber', 3, { unit: 'DA' });
    const report = assessCompleteness({
      items: [scrubber],
      rooms: [living],
    });
    assert.ok(report.issues.some((issue) => /without filter/.test(issue.message)));
  });

  it('surfaces unmatched mitigation removals', () => {
    const mitigation = parseMitigationEstimate(
      'Room,Code,Description,Quantity,Unit\nKitchen,DMO X,"Remove wallpaper",40.00,SF',
      { source: 'test', format: 'csv' },
    );
    const derivation = deriveRebuildScope(mitigation);
    const report = assessCompleteness({
      items: [],
      rooms: FIXTURES.project.rooms,
      derivation,
      mitigation,
    });
    assert.ok(report.unmatchedRemovals.length >= 1);
    assert.ok(report.issues.some((issue) => /wallpaper/.test(issue.message)));
  });
});

describe('end-to-end thorough rebuild from fixture', () => {
  const mitigation = parseMitigationEstimate(FIXTURES.mitigationCsv, {
    source: 'fixture',
    format: 'csv',
  });
  const derived = deriveRebuildScope(mitigation);
  const scope = buildScope({
    rooms: FIXTURES.project.rooms,
    observations: [],
    directives: {
      ...EMPTY_DIRECTIVES,
      roomsOutOfScope: ['Office'],
      waterCategory: 1,
      floodCutHeightFt: 2,
      materialsByRoom: [{ room: 'Living Room', material: 'LVP' }],
      directives: ['Replace like for like'],
    },
    mitigationItems: derived.items,
    address: FIXTURES.jobs[0]!.address,
  });
  const estimate = buildEstimate({
    job: FIXTURES.jobs[0]!,
    rooms: FIXTURES.project.rooms,
    scope: scope.items,
    basis: 'mitigation',
    warnings: scope.warnings,
    derivation: derived,
    mitigation,
  });

  it('still excludes mitigation dryout from the rebuild', () => {
    const text = JSON.stringify(estimate.lineItems);
    for (const token of ['Air mover', 'Dehumidifier', 'antimicrobial', 'technician', 'monitoring']) {
      assert.ok(!text.includes(token), `${token} leaked into the construction estimate`);
    }
  });

  it('includes construction HEPA scrubbers and filters for dusty rooms', () => {
    assert.ok(estimate.lineItems.some((line) => line.code === codeFor('hepa_air_scrubber')));
    assert.ok(estimate.lineItems.some((line) => line.code === codeFor('hepa_filter_change')));
  });

  it('includes drywall primer and electrical resets with wall rebuild', () => {
    const livingLines = estimate.lineItems.filter((line) => line.roomName === 'Living Room');
    assert.ok(livingLines.some((line) => line.code === codeFor('drywall_primer')));
    assert.ok(livingLines.some((line) => line.code === codeFor('outlet_reset')));
  });

  it('includes LVP underlayment and carpet tack strip', () => {
    assert.ok(
      estimate.lineItems.some(
        (line) => line.roomName === 'Living Room' && line.code === codeFor('floor_underlayment'),
      ),
    );
    assert.ok(
      estimate.lineItems.some(
        (line) => line.roomName === 'Master Bedroom' && line.code === codeFor('carpet_tack_strip'),
      ),
    );
  });

  it('passes readiness — assemblies are complete enough to export', () => {
    assert.deepEqual(readinessIssues(estimate), []);
  });

  it('records a completeness report on the estimate', () => {
    assert.ok(estimate.completeness);
    assert.equal(estimate.completeness!.criticalCount, 0);
  });
});
