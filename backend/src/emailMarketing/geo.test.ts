import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  geometryApproxRadiusMiles,
  geometryCentroid,
  haversineMiles,
  matchPointToStorm,
  pointInGeometry,
} from './geo.js';
import { matchContactsToStorm } from './match.js';
import {
  buildTemplateContext,
  renderStormEmail,
  renderTemplate,
} from './templates.js';
import type { MapContact } from './types.js';

describe('emailMarketing/geo', () => {
  it('computes haversine distance between nearby cities', () => {
    // Des Moines → Ames is roughly 30 miles.
    const miles = haversineMiles(
      { lat: 41.5868, lng: -93.625 },
      { lat: 42.0308, lng: -93.6319 },
    );
    assert.ok(miles > 25 && miles < 40, `expected ~30 miles, got ${miles}`);
  });

  it('matches points inside a radius circle', () => {
    const storm = {
      center: { lat: 41.6, lng: -93.6 },
      radiusMiles: 20,
      geometry: null,
    };
    const inside = matchPointToStorm({ lat: 41.65, lng: -93.55 }, storm);
    const outside = matchPointToStorm({ lat: 42.5, lng: -93.6 }, storm);
    assert.equal(inside.matched, true);
    assert.equal(outside.matched, false);
  });

  it('prefers polygon geometry over radius', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-93.7, 41.5],
          [-93.5, 41.5],
          [-93.5, 41.7],
          [-93.7, 41.7],
          [-93.7, 41.5],
        ],
      ],
    };

    assert.equal(pointInGeometry({ lat: 41.6, lng: -93.6 }, geometry), true);
    assert.equal(pointInGeometry({ lat: 42.0, lng: -93.6 }, geometry), false);

    const centroid = geometryCentroid(geometry);
    assert.ok(Math.abs(centroid.lat - 41.6) < 0.01);
    assert.ok(Math.abs(centroid.lng - (-93.6)) < 0.01);

    const radius = geometryApproxRadiusMiles(geometry);
    assert.ok(radius >= 5);

    // Point outside the polygon but inside a huge radius must NOT match.
    const result = matchPointToStorm(
      { lat: 42.0, lng: -93.6 },
      { center: { lat: 41.6, lng: -93.6 }, radiusMiles: 500, geometry },
    );
    assert.equal(result.matched, false);
  });
});

describe('emailMarketing/match', () => {
  const contacts: MapContact[] = [
    {
      contactId: 'c1',
      propertyId: 'p1',
      name: 'Ada Homeowner',
      email: 'ada@example.com',
      phone: null,
      city: 'Des Moines',
      region: 'IA',
      lat: 41.6,
      lng: -93.6,
      marketingOptOut: false,
      label: null,
    },
    {
      contactId: 'c2',
      propertyId: 'p2',
      name: 'Opt Out',
      email: 'out@example.com',
      phone: null,
      city: 'Des Moines',
      region: 'IA',
      lat: 41.61,
      lng: -93.61,
      marketingOptOut: true,
      label: null,
    },
    {
      contactId: 'c3',
      propertyId: 'p3',
      name: 'Far Away',
      email: 'far@example.com',
      phone: null,
      city: 'Denver',
      region: 'CO',
      lat: 39.74,
      lng: -104.99,
      marketingOptOut: false,
      label: null,
    },
  ];

  it('returns in-path contacts and flags opt-outs', () => {
    const matches = matchContactsToStorm(contacts, {
      center: { lat: 41.6, lng: -93.6 },
      radiusMiles: 30,
      geometry: null,
    });

    assert.equal(matches.length, 2);
    assert.equal(matches[0]!.contactId, 'c1');
    assert.equal(matches[0]!.skipReason, null);
    assert.equal(matches[1]!.skipReason, 'marketing_opt_out');
  });
});

describe('emailMarketing/templates', () => {
  it('renders storm email tokens', () => {
    const ctx = buildTemplateContext(
      { name: 'Ada Lovelace', city: 'Des Moines', region: 'IA' },
      {
        name: 'Severe Thunderstorm Warning',
        eventType: 'Severe Thunderstorm Warning',
        headline: 'Severe Thunderstorm Warning for Polk County',
        areaDesc: 'Polk County',
      },
      {
        fromName: 'Midwest Restore',
        companySignature: 'Jordan at Midwest Restore',
        includeOfferOfHelp: true,
      },
    );

    assert.equal(ctx.contactFirstName, 'Ada');
    const email = renderStormEmail(
      'Checking in — {{eventType}} near {{city}}',
      'Hi {{contactFirstName}},\n\n{{offer}}\n\n{{signature}}',
      ctx,
    );

    assert.match(email.subject, /Severe Thunderstorm Warning near Des Moines/);
    assert.match(email.bodyText, /Hi Ada/);
    assert.match(email.bodyText, /Jordan at Midwest Restore/);
    assert.match(email.bodyText, /water extraction|walkthrough|tarping/i);
    assert.equal(renderTemplate('{{unknown}}', ctx), '{{unknown}}');
  });
});
