import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cityPostalFromAddress,
  normalizeCountry,
  propertyRowFromResolved,
  propertyRowFromTyped,
  siteAddressFacts,
} from '../src/lib/propertyAddress.js';
import { resolvedFromComponents } from '../src/lib/googlePlaces.js';

test('cityPostalFromAddress reads a US Places line', () => {
  assert.deepEqual(cityPostalFromAddress('East Racine Avenue, Waukesha, Wisconsin, 53186, US'), {
    city: 'Waukesha',
    postalCode: '53186',
  });
});

test('cityPostalFromAddress reads a UK Google / OSM line', () => {
  assert.deepEqual(cityPostalFromAddress('School Street, Llanbradach, Wales, CF83 3NB, GB'), {
    city: 'Llanbradach',
    postalCode: 'CF83 3NB',
  });
});

test('normalizeCountry maps UK names to GB', () => {
  assert.equal(normalizeCountry('Wales'), 'GB');
  assert.equal(normalizeCountry('UK'), 'GB');
  assert.equal(normalizeCountry('gb'), 'GB');
  assert.equal(normalizeCountry('United States'), 'US');
  assert.equal(normalizeCountry(''), 'US');
});

test('propertyRowFromResolved truncates and stores Google street + coords', () => {
  const resolved = resolvedFromComponents({
    placeId: 'places/ChIJtest',
    formatted: 'School Street, Llanbradach, Caerphilly CF83 3NB, UK',
    components: [
      { longText: 'School Street', shortText: 'School St', types: ['route'] },
      { longText: 'Llanbradach', types: ['postal_town'] },
      { longText: 'CF83 3NB', types: ['postal_code'] },
      { longText: 'United Kingdom', shortText: 'GB', types: ['country'] },
    ],
    lat: 51.6061,
    lng: -3.2294,
  });
  assert.equal(resolved.addressLine1, 'School Street');
  assert.equal(resolved.city, 'Llanbradach');
  assert.equal(resolved.postalCode, 'CF83 3NB');
  assert.equal(resolved.country, 'GB');

  const row = propertyRowFromResolved('org-1', resolved, 'School Street, Llanbradach, Wales, CF83 3NB, GB');
  assert.equal(row.org_id, 'org-1');
  assert.equal(row.address_line1, 'School Street');
  assert.equal(row.city, 'Llanbradach');
  assert.equal(row.postal_code, 'CF83 3NB');
  assert.equal(row.country, 'GB');
  assert.equal(row.latitude, 51.6061);
  assert.equal(row.longitude, -3.2294);
});

test('siteAddressFacts writes Site and Site address for the dashboard', () => {
  assert.deepEqual(
    siteAddressFacts({ line: 'School Street', city: 'Llanbradach', postalCode: 'CF83 3NB' }, { Work: 'Extract' }),
    {
      Work: 'Extract',
      Site: 'School Street',
      'Site address': 'School Street, Llanbradach, CF83 3NB',
    },
  );
});

test('propertyRowFromTyped keeps a typed line under the column limit', () => {
  const row = propertyRowFromTyped(
    'org-1',
    'School Street, Llanbradach, Wales, CF83 3NB, GB',
    '',
    '',
  );
  assert.equal(row.address_line1, 'School Street, Llanbradach, Wales, CF83 3NB, GB');
  assert.equal(row.city, 'Llanbradach');
  assert.equal(row.postal_code, 'CF83 3NB');
});
