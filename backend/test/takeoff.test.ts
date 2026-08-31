import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTakeoff, workLinesOf, type WorkLine } from '../src/purchasing/takeoff.js';
import { DEMANDS_BY_CODE, MATERIAL_BY_KEY, NO_MATERIALS_REASON } from '../src/purchasing/materials.js';

/**
 * The takeoff.
 *
 * The property that pays for these tests is aggregate-first-round-last: it is
 * the difference between ordering what a job needs and quietly over-ordering
 * on every multi-room job. The rest is the classification contract — every
 * estimate line accounted for in exactly one bucket.
 *
 * Work codes here are the legacy estimate vocabulary (WTR*, CLN*, …) that
 * purchasing still reads from stored estimate payloads. They are not the
 * construction estimator catalog keys.
 */

const line = (over: Partial<WorkLine> & { catalogKey: string; quantity: number }): WorkLine => ({
  id: over.id ?? `${over.catalogKey}-${Math.abs(over.quantity)}`,
  description: over.description ?? over.catalogKey,
  unit: over.unit ?? 'SF',
  roomName: over.roomName,
  catalogKey: over.catalogKey,
  quantity: over.quantity,
});

test('aggregates raw need across rooms before rounding to purchase units', () => {
  // 100 + 60 = 160 SF of drywall. With 10% waste: 176 / 32 = 5.5 → 6 sheets.
  // Rounded per room it would be ceil(110/32) + ceil(66/32) = 4 + 3 = 7.
  const result = buildTakeoff([
    line({ id: 'a', catalogKey: 'WTRDRYWL', quantity: 100, roomName: 'Kitchen' }),
    line({ id: 'b', catalogKey: 'WTRDRYWL', quantity: 60, roomName: 'Hall' }),
  ]);
  const drywall = result.lines.find((l) => l.materialKey === 'drywall_half');
  assert.ok(drywall);
  assert.equal(drywall.quantity, 6);
  assert.deepEqual(drywall.sourceLineIds, ['a', 'b']);
  assert.match(drywall.sourceSummary, /160 SF/);
  assert.match(drywall.sourceSummary, /Kitchen, Hall/);
});

test('contractor bags accumulate across different tear-out trades', () => {
  // 300 SF drywall + 300 SF insulation = 600 SF of debris → 2 boxes (400 SF each),
  // not 1 + 1 computed separately... which would coincidentally also be 2, so use
  // quantities where the split disagrees: 100 + 100 = 200 → 1 box, split would be 2.
  const result = buildTakeoff([
    line({ catalogKey: 'WTRDRYWL', quantity: 100 }),
    line({ catalogKey: 'WTRINS', quantity: 100 }),
  ]);
  const bags = result.lines.find((l) => l.materialKey === 'contractor_bags');
  assert.ok(bags);
  assert.equal(bags.quantity, 1);
});

test('zero-quantity lines are counted, not ordered', () => {
  const result = buildTakeoff([
    line({ catalogKey: 'WTRDRYWL', quantity: 0 }),
    line({ catalogKey: 'WTRBB', quantity: 24, unit: 'LF' }),
  ]);
  assert.equal(result.zeroQuantity, 1);
  assert.ok(!result.lines.some((l) => l.materialKey === 'drywall_half'));
  const base = result.lines.find((l) => l.materialKey === 'baseboard_mdf');
  // 24 LF * 1.1 waste = 26.4 / 8 ft sticks → 4.
  assert.equal(base?.quantity, 4);
});

test('equipment and labour codes are classified with reasons, never ordered', () => {
  const result = buildTakeoff([
    line({ catalogKey: 'WTRDHM', quantity: 6, unit: 'DA', description: 'Dehumidifier' }),
    line({ catalogKey: 'CLNCONT', quantity: 4, unit: 'HR', description: 'Content manipulation' }),
  ]);
  assert.equal(result.lines.length, 0);
  assert.equal(result.noMaterials.length, 2);
  const dehu = result.noMaterials.find((n) => n.catalogKey === 'WTRDHM');
  assert.match(dehu!.reason, /equipment/);
});

test('unknown codes surface as unmapped rather than disappearing', () => {
  const result = buildTakeoff([
    line({ catalogKey: 'XYZNEW', quantity: 50, description: 'Some new work' }),
  ]);
  assert.equal(result.lines.length, 0);
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0].description, 'Some new work');
  assert.equal(result.unmapped[0].quantity, 50);
});

test('special-order materials carry their note onto the line', () => {
  const result = buildTakeoff([line({ catalogKey: 'WTRTCP', quantity: 240 })]);
  const carpet = result.lines.find((l) => l.materialKey === 'carpet');
  assert.ok(carpet);
  assert.match(carpet.note ?? '', /flooring desk/);
});

test('empty input produces an empty, priced-at-zero takeoff', () => {
  const result = buildTakeoff([]);
  assert.deepEqual(result.lines, []);
  assert.equal(result.estTotal, 0);
});

test('estTotal is the sum of line totals', () => {
  const result = buildTakeoff([line({ catalogKey: 'DMOPPE', quantity: 3, unit: 'DA' })]);
  const kit = result.lines.find((l) => l.materialKey === 'ppe_day_kit');
  assert.equal(kit?.quantity, 3);
  assert.equal(result.estTotal, kit!.estTotal);
});

test('a work code is either mapped to materials or classified — never both', () => {
  const mapped = new Set(Object.keys(DEMANDS_BY_CODE));
  const classified = new Set(Object.keys(NO_MATERIALS_REASON));
  const overlap = [...mapped].filter((key) => classified.has(key));
  assert.deepEqual(overlap, [], `codes both mapped and classified: ${overlap.join(', ')}`);
});

test('every demand names a material that exists', () => {
  for (const demands of Object.values(DEMANDS_BY_CODE)) {
    for (const demand of demands) {
      assert.ok(
        MATERIAL_BY_KEY.has(demand.materialKey),
        `demand names missing material ${demand.materialKey}`,
      );
      assert.ok(demand.coverage > 0);
    }
  }
});

test('workLinesOf reads a stored payload defensively', () => {
  assert.deepEqual(workLinesOf(null), []);
  assert.deepEqual(workLinesOf({}), []);
  const lines = workLinesOf({
    lineItems: [
      { catalogKey: 'WTRDRYWL', quantity: 80, description: 'Tear out', unit: 'SF', id: 'x' },
      { catalogKey: 42, quantity: 'nope' }, // malformed row is dropped, not thrown on
    ],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].catalogKey, 'WTRDRYWL');
});
