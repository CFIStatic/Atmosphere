import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEstimate, DEFAULT_ESTIMATOR_CONFIG } from '../src/estimator/mitigation/agent.js';
import {
  airMoversForFloodCut,
  buildEquipmentPlan,
} from '../src/estimator/mitigation/planning/equipmentPlan.js';
import { mergeDryingReports } from '../src/estimator/mitigation/planning/dryingProgress.js';
import { floodCutSF } from '../src/estimator/mitigation/lib/geometry.js';
import type { LossAssessment } from '../src/estimator/mitigation/types.js';

/**
 * Smart equipment sizing + drying-report progress.
 *
 * Canonical question: "We are doing a 2-foot flood cut — how many air movers?"
 * Answer: open wall SF = perimeter × (cutHeight/12), then S500 coverage
 * (1 + ceil(floor/60) + ceil((wall+ceiling)/125) + offsets).
 */

describe('airMoversForFloodCut', () => {
  it('sizes movers from a 24" (2 ft) flood cut on open wall SF', () => {
    // 40 LF perimeter × 2 ft cut = 80 SF open cavity.
    assert.equal(floodCutSF(40, 24), 80);

    // 120 SF wet floor → ceil(120/60)=2; 80 SF open wall → ceil(80/125)=1;
    // + 1 room baseline = 4 movers.
    const movers = airMoversForFloodCut({
      perimeterLF: 40,
      cutHeightIn: 24,
      wetFloorSF: 120,
      wetCeilingSF: 0,
      offsets: 0,
    });
    assert.equal(movers, 4);
  });

  it('adds offset units and ceiling surface into the upper allowance', () => {
    // Floor 60 → 1; open wall 40×4ft=160 + ceiling 100 = 260 → ceil(260/125)=3;
    // + baseline 1 + 2 offsets = 7.
    const movers = airMoversForFloodCut({
      perimeterLF: 40,
      cutHeightIn: 48,
      wetFloorSF: 60,
      wetCeilingSF: 100,
      offsets: 2,
    });
    assert.equal(movers, 7);
  });
});

describe('buildEquipmentPlan flood cut', () => {
  it('plans room movers from documented 24" cut with rationale', () => {
    const assessment = {
      jobId: 'flood-cut-plan',
      cause: 'supply_line' as const,
      sourceCategory: 1 as const,
      category: 1 as const,
      class: 2 as const,
      rooms: [
        {
          id: 'kitchen',
          name: 'Kitchen',
          level: '1',
          geometry: {
            lengthFt: 12,
            widthFt: 14,
            heightFt: 8,
            floorSF: 168,
            wallSF: 416,
            ceilingSF: 168,
            perimeterLF: 52,
            offsets: 0,
            openingSF: 0,
          },
          affectedFloorFraction: 1,
          ceilingAffected: false,
          materials: [
            {
              material: 'drywall' as const,
              surface: 'wall' as const,
              quantity: 104,
              unit: 'SF' as const,
              porous: true,
              salvageable: false,
              cavityWet: true,
              wetHeightIn: 12,
            },
          ],
          documentedCutHeightIn: 24,
        },
      ],
      moistureReadings: [],
      psychrometrics: [],
      equipment: [],
      evidence: [],
      findings: [],
      dryingDays: 3,
      monitoringVisits: 3,
      microbialGrowthPresent: false,
      containmentRequired: false,
      sourcesUsed: ['notes' as const],
      warnings: [],
      dateOfArrival: '2024-05-17',
    } satisfies LossAssessment;

    const plan = buildEquipmentPlan(assessment);
    assert.ok(plan.airMoversRequired > 0);
    const kitchen = plan.rooms.find((r) => r.roomId === 'kitchen');
    assert.ok(kitchen);
    assert.equal(kitchen!.cutHeightIn, 24);
    assert.equal(kitchen!.openWallSF, floodCutSF(52, 24)); // 104
    assert.equal(kitchen!.floodCutRequired, true);
    // 1 + ceil(168/60)=3 + ceil(104/125)=1 = 5
    assert.equal(kitchen!.airMoversRequired, 5);
    assert.match(kitchen!.rationale, /24" flood cut/i);
    assert.match(kitchen!.rationale, /104 SF/i);
  });
});

describe('mergeDryingReports', () => {
  it('accumulates visits, tracks dry/wet rooms, and expands drying days', () => {
    const merged = mergeDryingReports(
      [
        {
          id: 'v1',
          takenAt: '2024-05-17T10:00:00Z',
          source: 'manual',
          notes: 'Setup day — flood cut complete',
          roomsStillWet: ['Kitchen', 'Hall'],
          equipment: [
            { kind: 'air_mover', quantity: 4, placedAt: '2024-05-17T10:00:00Z' },
            { kind: 'dehumidifier_lgr', quantity: 1, placedAt: '2024-05-17T10:00:00Z' },
          ],
          psychrometrics: [
            {
              takenAt: '2024-05-17T10:00:00Z',
              zone: 'affected',
              temperatureF: 72,
              relativeHumidity: 60,
            },
            {
              takenAt: '2024-05-17T10:00:00Z',
              zone: 'unaffected',
              temperatureF: 72,
              relativeHumidity: 45,
            },
          ],
        },
        {
          id: 'v2',
          takenAt: '2024-05-19T10:00:00Z',
          source: 'manual',
          notes: 'Hall at goal',
          roomsAtDryStandard: ['Hall'],
          roomsStillWet: ['Kitchen'],
          equipment: [
            { kind: 'air_mover', quantity: 5, placedAt: '2024-05-17T10:00:00Z' },
            { kind: 'dehumidifier_lgr', quantity: 2, placedAt: '2024-05-17T10:00:00Z' },
          ],
          psychrometrics: [
            {
              takenAt: '2024-05-19T10:00:00Z',
              zone: 'affected',
              temperatureF: 75,
              relativeHumidity: 40,
            },
            {
              takenAt: '2024-05-19T10:00:00Z',
              zone: 'unaffected',
              temperatureF: 72,
              relativeHumidity: 50,
            },
          ],
        },
        {
          id: 'v3',
          takenAt: '2024-05-21T10:00:00Z',
          source: 'manual',
          roomsAtDryStandard: ['Kitchen'],
          notes: 'Pull day',
        },
      ],
      { dryingDays: 1, monitoringVisits: 1 },
    );

    assert.equal(merged.progress.visitCount, 3);
    assert.ok(merged.dryingDays >= 5); // May 17 → 21 inclusive
    assert.equal(merged.monitoringVisits, Math.max(3, merged.dryingDays));
    assert.ok(merged.progress.roomsAtDryStandard.includes('Hall'));
    assert.ok(merged.progress.roomsAtDryStandard.includes('Kitchen'));
    assert.equal(merged.progress.roomsStillWet.length, 0);
    assert.equal(merged.progress.dryingComplete, true);
    assert.equal(merged.progress.suggestedRemainingDays, 0);
    // Latest equipment snapshot wins (visit 2).
    assert.equal(
      merged.equipment.find((e) => e.kind === 'air_mover')?.quantity,
      5,
    );
    assert.equal(merged.progress.timeline.length, 3);
    assert.match(merged.progress.timeline[1].summary, /Hall/i);
  });

  it('re-wets a room that was previously marked dry', () => {
    const merged = mergeDryingReports([
      {
        id: 'a',
        takenAt: '2024-06-01T12:00:00Z',
        source: 'manual',
        roomsAtDryStandard: ['Bath'],
      },
      {
        id: 'b',
        takenAt: '2024-06-02T12:00:00Z',
        source: 'manual',
        roomsStillWet: ['Bath'],
      },
    ]);
    assert.ok(merged.progress.roomsStillWet.includes('Bath'));
    assert.equal(merged.progress.roomsAtDryStandard.includes('Bath'), false);
    assert.equal(merged.progress.dryingComplete, false);
  });
});

describe('estimate includes equipmentPlan from flood cut', () => {
  it('attaches equipmentPlan with flood-cut air-mover sizing on photos+notes', () => {
    const estimate = buildEstimate(
      {
        jobId: 'smart-plan-demo',
        photos: [
          {
            filename: 'cut.jpg',
            capturedAt: '2024-05-17T10:00:00Z',
            caption: 'flood cut 24in kitchen north wall',
            roomName: 'Kitchen',
          },
        ],
        notes: `
Cat 3 sewage. Kitchen 12x14. Carpet and pad out. Flood cut 24in, cavity wet.
6 air movers 2 lgr 1 scrubber. Containment built.
`,
        dryingReports: [
          {
            id: 'day2',
            takenAt: '2024-05-18T09:00:00Z',
            source: 'manual',
            notes: 'Monitoring day 2 — kitchen still wet',
            roomsStillWet: ['Kitchen'],
            psychrometrics: [
              {
                takenAt: '2024-05-18T09:00:00Z',
                zone: 'affected',
                temperatureF: 74,
                relativeHumidity: 42,
              },
              {
                takenAt: '2024-05-18T09:00:00Z',
                zone: 'unaffected',
                temperatureF: 72,
                relativeHumidity: 50,
              },
            ],
          },
        ],
      },
      DEFAULT_ESTIMATOR_CONFIG,
    );

    assert.ok(estimate.equipmentPlan, 'estimate should carry equipmentPlan');
    assert.ok(estimate.equipmentPlan!.airMoversRequired >= 4);
    const kitchen = estimate.equipmentPlan!.rooms.find((r) =>
      /kitchen/i.test(r.roomName),
    );
    assert.ok(kitchen, 'kitchen room plan expected');
    assert.equal(kitchen!.cutHeightIn, 24);
    assert.ok(kitchen!.openWallSF > 0);
    assert.match(kitchen!.rationale, /flood cut/i);

    assert.ok(estimate.dryingProgress, 'estimate should carry dryingProgress');
    assert.equal(estimate.dryingProgress!.visitCount, 1);
    assert.ok(estimate.dryingProgress!.roomsStillWet.includes('Kitchen'));
    assert.match(estimate.narrative, /air mover/i);
  });
});
