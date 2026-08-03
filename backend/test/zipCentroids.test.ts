import test from 'node:test';
import assert from 'node:assert/strict';
import { zipTable, zipRecord, centroidFor } from '../src/campaigns/zipCentroids.data.js';
import { zipToState } from '../src/campaigns/zips.js';

/**
 * The bundled ZIP table.
 *
 * It is delta-encoded, which means a single bad row does not corrupt one
 * lookup — it shifts every row after it. A decoder bug would put half the
 * country a few degrees off and nothing would throw, so these tests check
 * anchors spread across the file rather than just the first few.
 */

test('the table decodes to the expected size', () => {
  const table = zipTable();
  // Around forty-two thousand codes. The exact number moves when the source
  // data is refreshed; an order-of-magnitude drop means the decode broke.
  assert.ok(table.size > 40_000, `only ${table.size} rows decoded`);
  assert.ok(table.size < 45_000, `${table.size} rows is more than the US has`);
});

test('known ZIPs land where they actually are', () => {
  // Spread through the sort order, because delta encoding means an error
  // early would only show up late.
  const anchors: Array<[string, number, number, string]> = [
    ['02108', 42.36, -71.07, 'MA'], // Beacon Hill, near the start of the file
    ['10001', 40.75, -73.99, 'NY'],
    ['33101', 25.78, -80.2, 'FL'],
    ['60601', 41.89, -87.62, 'IL'],
    ['78664', 30.51, -97.67, 'TX'], // Round Rock
    ['90210', 34.09, -118.41, 'CA'],
    ['99501', 61.21, -149.88, 'AK'], // near the end
  ];

  for (const [zip, lat, lon, state] of anchors) {
    const row = zipRecord(zip);
    assert.ok(row, `${zip} missing from the table`);
    // Within about seven miles: these are centroids, and the reference values
    // here are rounded.
    assert.ok(Math.abs(row.lat - lat) < 0.1, `${zip} latitude ${row.lat}, expected near ${lat}`);
    assert.ok(Math.abs(row.lon - lon) < 0.1, `${zip} longitude ${row.lon}, expected near ${lon}`);
    assert.equal(row.state, state);
  }
});

test('leading-zero ZIPs survive the numeric encoding', () => {
  // Encoded as numbers and padded back to five digits. Getting this wrong
  // would lose all of New England.
  const row = zipRecord('01001');
  assert.ok(row);
  assert.equal(row.state, 'MA');
  assert.ok(zipRecord('00602')?.state === 'PR');
});

test('every position is somewhere the United States actually is', () => {
  // A decoder that drifted would push rows into the ocean gradually rather
  // than obviously, so this checks all forty-two thousand of them.
  let checked = 0;
  for (const [zip, row] of zipTable()) {
    assert.ok(/^\d{5}$/.test(zip), `malformed key ${zip}`);
    assert.ok(
      row.lat > -15 && row.lat < 72,
      `${zip} at latitude ${row.lat} is outside anywhere the US reaches`,
    );
    assert.ok(
      row.lon > -180 && row.lon < 180,
      `${zip} at longitude ${row.lon} is not a longitude`,
    );
    assert.ok(/^[A-Z]{2}$/.test(row.state), `${zip} has state ${JSON.stringify(row.state)}`);
    checked += 1;
  }
  assert.ok(checked > 40_000);
});

test('military ZIPs are absent rather than pointing at the Atlantic', () => {
  // 09xxx APO Europe carried 0,0 in the source, which is a point off Africa.
  assert.equal(zipRecord('09002'), null);
  assert.equal(centroidFor('34001'), null);
});

test('zipToState prefers the table over the range inference', () => {
  // The whole reason to carry states in the table: these sit outside their own
  // state's block, and the range table only knows the ones somebody listed.
  assert.equal(zipToState('73301'), 'TX'); // IRS Austin, inside Oklahoma's range
  assert.equal(zipToState('06390'), 'NY'); // Fishers Island, inside Connecticut's
  assert.equal(zipToState('00501'), 'NY'); // IRS Holtsville
});

test('an unknown code still falls back to the ranges', () => {
  // Not allocated, so not in the table. The range table should still place it
  // rather than returning null and dropping the territory off the weather map.
  assert.equal(zipRecord('78999'), null);
  assert.equal(zipToState('78999'), 'TX');
});

test('nonsense stays null', () => {
  assert.equal(zipToState('abcde'), null);
  assert.equal(zipToState('1234'), null);
  assert.equal(zipToState(''), null);
  assert.equal(zipToState(null), null);
});
