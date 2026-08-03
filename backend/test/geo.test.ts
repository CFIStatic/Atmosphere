import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryContains, boundsOf, milesBetween, placesInAlert } from '../src/campaigns/geo.js';

/**
 * Point-in-polygon decides who is inside a storm and therefore who gets
 * emailed. Two failure modes matter and neither announces itself:
 *
 *   Swapped coordinates. GeoJSON is [lon, lat], which is the reverse of how
 *   everyone says it. Getting it backwards puts Texas in the Indian Ocean and
 *   returns a confident, wrong answer.
 *
 *   A malformed shape treated as "inside". Every unparseable case here must
 *   fall closed, because the alternative is mailing people who are nowhere
 *   near the weather.
 */

/** A square around Round Rock, in GeoJSON order: [lon, lat]. */
const square = {
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

test('a point inside the polygon is inside', () => {
  assert.equal(geometryContains(square, { lat: 30.51, lon: -97.68 }), true);
});

test('a point outside is outside', () => {
  // San Antonio — well south and west of the square.
  assert.equal(geometryContains(square, { lat: 29.42, lon: -98.49 }), false);
  // Just over the northern edge.
  assert.equal(geometryContains(square, { lat: 30.7, lon: -97.68 }), false);
});

test('latitude and longitude are not interchangeable', () => {
  // The bug this guards: feeding lat where lon belongs. If the implementation
  // ever swapped them, the first assertion below would start passing.
  assert.equal(geometryContains(square, { lat: -97.68, lon: 30.51 }), false);
  assert.equal(geometryContains(square, { lat: 30.51, lon: -97.68 }), true);
});

test('a hole in the polygon really is outside it', () => {
  // Alerts genuinely exclude areas — a rural zone with a metro cut out of it.
  // Ignoring holes puts people inside a storm they are demonstrably outside.
  const withHole = {
    type: 'Polygon',
    coordinates: [
      square.coordinates[0],
      [
        [-97.7, 30.5],
        [-97.65, 30.5],
        [-97.65, 30.55],
        [-97.7, 30.55],
        [-97.7, 30.5],
      ],
    ],
  };
  assert.equal(geometryContains(withHole, { lat: 30.52, lon: -97.675 }), false, 'in the hole');
  assert.equal(geometryContains(withHole, { lat: 30.47, lon: -97.7 }), true, 'in the ring');
});

test('a MultiPolygon matches any of its parts', () => {
  const multi = {
    type: 'MultiPolygon',
    coordinates: [
      square.coordinates,
      [
        [
          [-98.6, 29.3],
          [-98.4, 29.3],
          [-98.4, 29.5],
          [-98.6, 29.5],
          [-98.6, 29.3],
        ],
      ],
    ],
  };
  assert.equal(geometryContains(multi, { lat: 30.51, lon: -97.68 }), true);
  assert.equal(geometryContains(multi, { lat: 29.42, lon: -98.49 }), true);
  assert.equal(geometryContains(multi, { lat: 32.78, lon: -96.8 }), false);
});

test('anything unparseable falls closed', () => {
  // Never "inside" by accident. Each of these would otherwise be a silent
  // decision to email somebody.
  for (const bad of [null, undefined, {}, { type: 'Point', coordinates: [1, 2] }, { type: 'Polygon' }]) {
    assert.equal(geometryContains(bad as any, { lat: 30.51, lon: -97.68 }), false);
  }
  assert.equal(geometryContains(square, { lat: NaN, lon: -97.68 }), false);
});

test('bounds cover the shape', () => {
  const b = boundsOf(square);
  assert.ok(b);
  assert.equal(b.south, 30.45);
  assert.equal(b.north, 30.6);
  assert.equal(b.west, -97.75);
  assert.equal(b.east, -97.6);
});

test('distance is right to within a mile', () => {
  // Austin to San Antonio is about 74 miles as the crow flies.
  const miles = milesBetween({ lat: 30.2672, lon: -97.7431 }, { lat: 29.4241, lon: -98.4936 });
  assert.ok(miles > 70 && miles < 80, `expected ~74, got ${miles}`);
});

test('places are matched by geometry when the alert has any', () => {
  const places = [
    { id: 'a', lat: 30.51, lon: -97.68, city: 'Round Rock' },
    { id: 'b', lat: 29.42, lon: -98.49, city: 'San Antonio' },
    { id: 'c', lat: null, lon: null, city: 'Round Rock' },
  ];
  const { inside, method } = placesInAlert({ geometry: square, areaDesc: 'Williamson' }, places);
  assert.equal(method, 'geometry');
  assert.deepEqual(inside.map((p) => p.id), ['a']);
});

test('without geometry it falls back to the county names the office wrote', () => {
  // Watches are issued over whole zones and often carry no polygon. An alert
  // with no geometry must still reach the right people.
  const places = [
    { id: 'a', lat: null, lon: null, city: 'Round Rock' },
    { id: 'b', lat: null, lon: null, city: 'San Antonio' },
  ];
  const { inside, method } = placesInAlert({ areaDesc: 'Round Rock; Georgetown' }, places);
  assert.equal(method, 'area-name');
  assert.deepEqual(inside.map((p) => p.id), ['a']);
});

test('an alert with neither geometry nor areas matches nobody', () => {
  const { inside, method } = placesInAlert({}, [{ id: 'a', lat: 30.5, lon: -97.6, city: 'X' }]);
  assert.equal(method, 'none');
  assert.equal(inside.length, 0);
});
