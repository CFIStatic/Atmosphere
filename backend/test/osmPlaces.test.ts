import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cityFromPhoton,
  decodeOsmPlaceId,
  encodeOsmPlaceId,
  formatPhotonAddress,
  lineFromPhoton,
  resolvedFromPhoton,
  suggestionFromPhoton,
} from '../src/lib/osmPlaces.js';

describe('osmPlaces', () => {
  const whiteHouse = {
    geometry: { coordinates: [-77.0365525, 38.8976387] as [number, number] },
    properties: {
      osm_type: 'R',
      osm_id: 19761182,
      housenumber: '1600',
      street: 'Pennsylvania Avenue Northwest',
      city: 'Washington',
      state: 'District of Columbia',
      postcode: '20500',
      country: 'United States',
      countrycode: 'US',
      name: 'White House',
    },
  };

  it('formats a street line and city from Photon properties', () => {
    assert.equal(lineFromPhoton(whiteHouse.properties), '1600 Pennsylvania Avenue Northwest');
    assert.equal(cityFromPhoton(whiteHouse.properties), 'Washington');
    assert.match(formatPhotonAddress(whiteHouse.properties), /1600 Pennsylvania/);
    assert.match(formatPhotonAddress(whiteHouse.properties), /20500/);
  });

  it('round-trips osm place ids with coordinates', () => {
    const id = encodeOsmPlaceId({
      osmType: 'R',
      osmId: 19761182,
      lat: 38.8976387,
      lng: -77.0365525,
    });
    const decoded = decodeOsmPlaceId(id);
    assert.ok(decoded);
    assert.equal(decoded.osmType, 'R');
    assert.equal(decoded.osmId, '19761182');
    assert.equal(decoded.lat, 38.8976387);
    assert.equal(decoded.lng, -77.0365525);
  });

  it('builds autocomplete + resolved payloads from a Photon feature', () => {
    const suggestion = suggestionFromPhoton(whiteHouse);
    assert.ok(suggestion);
    assert.equal(suggestion.mainText, '1600 Pennsylvania Avenue Northwest');
    assert.match(suggestion.secondaryText, /Washington/);
    const resolved = resolvedFromPhoton(whiteHouse, suggestion.placeId);
    assert.equal(resolved.addressLine1, '1600 Pennsylvania Avenue Northwest');
    assert.equal(resolved.city, 'Washington');
    assert.equal(resolved.postalCode, '20500');
    assert.equal(resolved.lat, 38.8976387);
  });
});
