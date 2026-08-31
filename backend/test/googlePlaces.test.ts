import test from 'node:test';
import assert from 'node:assert/strict';
import { mapsKey, placesProvider, resolvedFromComponents } from '../src/lib/googlePlaces.js';

test('mapsKey prefers GOOGLE_MAPS_API_KEY over GOOGLE_PLACES_API_KEY', () => {
  const prevMaps = process.env.GOOGLE_MAPS_API_KEY;
  const prevPlaces = process.env.GOOGLE_PLACES_API_KEY;
  try {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    assert.equal(mapsKey(), '');
    assert.equal(placesProvider(), 'osm');

    process.env.GOOGLE_PLACES_API_KEY = 'places-only';
    assert.equal(mapsKey(), 'places-only');
    assert.equal(placesProvider(), 'google');

    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    assert.equal(mapsKey(), 'maps-key');
    assert.equal(placesProvider(), 'google');
  } finally {
    if (prevMaps === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = prevMaps;
    if (prevPlaces === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = prevPlaces;
  }
});

test('resolvedFromComponents prefers street number + route over the formatted line', () => {
  const resolved = resolvedFromComponents({
    placeId: 'places/abc',
    formatted: '1842 Meridian Ave, Austin, TX 78702, USA',
    components: [
      { longText: '1842', types: ['street_number'] },
      { longText: 'Meridian Avenue', shortText: 'Meridian Ave', types: ['route'] },
      { longText: 'Austin', types: ['locality'] },
      { longText: '78702', types: ['postal_code'] },
      { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1'] },
      { longText: 'United States', shortText: 'US', types: ['country'] },
    ],
    lat: 30.27,
    lng: -97.74,
  });
  assert.equal(resolved.placeId, 'abc');
  assert.equal(resolved.addressLine1, '1842 Meridian Avenue');
  assert.equal(resolved.city, 'Austin');
  assert.equal(resolved.postalCode, '78702');
  assert.equal(resolved.state, 'TX');
  assert.equal(resolved.country, 'US');
});
