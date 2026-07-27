import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  affectedArea,
  baseboardLength,
  casingLength,
  debrisLoads,
  doorCount,
  floodCutArea,
  netWallArea,
} from '../src/estimator/scope/quantities.js';
import type { RoomMeasurements } from '../src/estimator/types.js';

const room: RoomMeasurements = {
  id: 'room-1',
  name: 'Living Room',
  floorAreaSqFt: 288,
  ceilingAreaSqFt: 288,
  wallAreaSqFt: 544,
  perimeterLf: 68,
  ceilingHeightFt: 8,
  openings: [
    { kind: 'door', width: 3, height: 6.67 }, // 20.01 SF
    { kind: 'cased_opening', width: 5, height: 7, sharedWithRoomId: 'room-2' }, // 35 SF
    { kind: 'window', width: 5, height: 4 }, // 20 SF
    { kind: 'window', width: 1.5, height: 2 }, // 3 SF — below the deduction floor
  ],
};

describe('netWallArea', () => {
  it('deducts openings above the trade-practice floor and keeps small ones', () => {
    // 544 − (20.01 + 35 + 20); the 3 SF window is not worth cutting around.
    assert.equal(netWallArea(room), 468.99);
  });

  it('never returns a negative wall when the scan over-reports openings', () => {
    const impossible: RoomMeasurements = {
      ...room,
      wallAreaSqFt: 10,
      openings: [{ kind: 'door', width: 10, height: 10 }],
    };
    assert.equal(netWallArea(impossible), 0);
  });
});

describe('baseboardLength', () => {
  it('runs the perimeter less doorways and cased openings, but not windows', () => {
    // 68 − (3 door + 5 cased opening). Windows do not interrupt baseboard.
    assert.equal(baseboardLength(room), 60);
  });
});

describe('casingLength', () => {
  it('cases doors on three sides and windows on four', () => {
    // door 2×6.67 + 3 = 16.34; window 2×4 + 2×5 = 18; small window 2×2 + 2×1.5 = 7.
    // The cased opening is shared with another scoped room, so it is not billed twice.
    assert.equal(casingLength(room), 41.34);
  });
});

describe('doorCount', () => {
  it('ignores doors another scoped room already accounts for', () => {
    assert.equal(doorCount(room), 1);
    assert.equal(
      doorCount({
        ...room,
        openings: [{ kind: 'door', width: 3, height: 6.67, sharedWithRoomId: 'room-2' }],
      }),
      0,
    );
  });
});

describe('floodCutArea', () => {
  it('measures the band up from the floor', () => {
    assert.equal(floodCutArea(room, 2), 136);
  });

  it('cannot exceed the wall it is cut into', () => {
    assert.equal(floodCutArea(room, 20), 544);
  });
});

describe('affectedArea', () => {
  it('uses the whole surface when no fraction was observed', () => {
    assert.equal(affectedArea(400, undefined), 400);
  });

  it('floors small fractions at a quarter — drywall comes in sheets', () => {
    assert.equal(affectedArea(400, 0.05), 100);
  });

  it('never exceeds the surface', () => {
    assert.equal(affectedArea(400, 3), 400);
  });
});

describe('debrisLoads', () => {
  it('rounds up, because half a load is still a trip', () => {
    assert.equal(debrisLoads(0), 1);
    assert.equal(debrisLoads(250), 1);
    assert.equal(debrisLoads(251), 2);
  });
});
