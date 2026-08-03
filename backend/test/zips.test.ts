import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseZip,
  statesForTerritories,
  zipToState,
  zipsForTerritories,
} from '../src/campaigns/zips.js';
import { alertZipCoverage } from '../src/campaigns/weather.js';
import { geometryContains } from '../src/campaigns/geo.js';

/**
 * Territories are drawn in ZIP codes. Until this existed the postal_codes
 * array was stored and never read — a territory defined the normal way matched
 * no weather at all, silently, which is the worst kind of broken.
 */

test('a ZIP resolves to its state', () => {
  assert.equal(zipToState('78664'), 'TX'); // Round Rock
  assert.equal(zipToState('90210'), 'CA');
  assert.equal(zipToState('10001'), 'NY');
  assert.equal(zipToState('33101'), 'FL');
  assert.equal(zipToState('60601'), 'IL');
  assert.equal(zipToState('98101'), 'WA');
  assert.equal(zipToState('04101'), 'ME');
  assert.equal(zipToState('99501'), 'AK');
  assert.equal(zipToState('96813'), 'HI');
  assert.equal(zipToState('00901'), 'PR');
});

test('ZIP+4 and stray whitespace still resolve', () => {
  assert.equal(normaliseZip('78664-1234'), '78664');
  assert.equal(normaliseZip('  78664 '), '78664');
  assert.equal(zipToState('78664-1234'), 'TX');
  assert.equal(normaliseZip('7866'), null);
  assert.equal(normaliseZip('abcde'), null);
  assert.equal(zipToState(null), null);
});

test('codes outside their own state block resolve correctly', () => {
  // 73301 is an IRS address in Austin sitting inside Oklahoma's range, and
  // 06390 is Fishers Island NY inside Connecticut's. Rounding either away puts
  // a real customer in the wrong state's weather.
  assert.equal(zipToState('73301'), 'TX');
  assert.equal(zipToState('06390'), 'NY');
  assert.equal(zipToState('73401'), 'OK'); // an ordinary Oklahoma code
  assert.equal(zipToState('06001'), 'CT'); // an ordinary Connecticut code
});

test('the states to watch come from the territories themselves', () => {
  // This is what replaces a hardcoded 'TX'. Texarkana spans two states and a
  // franchise group spans a dozen.
  const states = statesForTerritories([
    { postal_codes: ['78664', '78681'] },
    { postal_codes: ['71854'] }, // Texarkana, Arkansas side
    { postal_codes: ['73501'] }, // Lawton, Oklahoma
  ]);
  assert.deepEqual(states, ['AR', 'OK', 'TX']);
});

test('an explicit state covers a territory described only by city name', () => {
  // "Springfield" is in thirty-odd states, so guessing from a city name would
  // poll half the country. An explicit state is how such a territory still
  // gets weather.
  assert.deepEqual(statesForTerritories([{ cities: ['Springfield'] } as any]), []);
  assert.deepEqual(statesForTerritories([{ state: 'MO', cities: ['Springfield'] } as any]), ['MO']);
});

test('ZIPs are de-duplicated and normalised across territories', () => {
  const zips = zipsForTerritories([
    { postal_codes: ['78664', '78664-1234', ' 78681 '] },
    { postal_codes: ['78681', 'nope'] },
  ]);
  assert.deepEqual(zips, ['78664', '78681']);
});

/* ---- matching an alert to ZIPs ------------------------------------------- */

// A square covering Round Rock only. Real warning polygons are this shape and
// this size — a fraction of a county.
const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-97.75, 30.45],
      [-97.6, 30.45],
      [-97.6, 30.6],
      [-97.75, 30.6],
      [-97.75, 30.45],
    ],
  ],
};

const centroids = new Map([
  ['78664', { lat: 30.51, lon: -97.65 }], // Round Rock — inside
  ['78681', { lat: 30.52, lon: -97.7 }], // Round Rock — inside
  ['78701', { lat: 30.27, lon: -97.74 }], // downtown Austin — outside
  ['78205', { lat: 29.42, lon: -98.49 }], // San Antonio — well outside
]);

const alert = (over: Record<string, unknown> = {}) =>
  ({
    id: 'a1',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    urgency: 'Expected',
    certainty: 'Likely',
    headline: null,
    areaDesc: 'Williamson; Travis',
    sameCodes: [],
    ugcCodes: [],
    effective: null,
    onset: null,
    expires: null,
    group: 'hail',
    geometry: polygon,
    ...over,
  }) as any;

test('a polygon picks out exactly the ZIPs under the storm', () => {
  // The whole point. The county name says "somewhere in 1,100 square miles";
  // the polygon says which four of your codes are actually under it.
  const cover = alertZipCoverage(
    alert(),
    { postal_codes: ['78664', '78681', '78701', '78205'] },
    centroids,
    geometryContains as any,
  );
  assert.equal(cover.method, 'geometry');
  assert.equal(cover.covered, true);
  assert.deepEqual(cover.zips.sort(), ['78664', '78681']);
});

test('a territory entirely outside the polygon does not match', () => {
  const cover = alertZipCoverage(
    alert(),
    { postal_codes: ['78205'] },
    centroids,
    geometryContains as any,
  );
  assert.equal(cover.covered, false);
  assert.deepEqual(cover.zips, []);
});

test('without a polygon it falls back to the county names', () => {
  // Watches are issued over whole zones and usually carry no geometry. They
  // must still reach the right people.
  const cover = alertZipCoverage(
    alert({ geometry: null }),
    { postal_codes: ['78664'], counties: ['Williamson County'] },
    centroids,
    geometryContains as any,
  );
  assert.equal(cover.method, 'area-name');
  assert.equal(cover.covered, true);
});

test('unlocated ZIPs fall back rather than silently reporting no match', () => {
  // "No ZIP was inside" and "we could not check any ZIP" are different, and
  // treating the second as the first would silently stop a campaign firing.
  const cover = alertZipCoverage(
    alert(),
    { postal_codes: ['99999'], counties: ['Williamson County'] },
    new Map(),
    geometryContains as any,
  );
  assert.equal(cover.method, 'area-name');
  assert.equal(cover.covered, true);
});

test('a territory with nothing defined still matches nothing', () => {
  const cover = alertZipCoverage(alert(), {}, centroids, geometryContains as any);
  assert.equal(cover.covered, false);
});
