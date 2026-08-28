import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasesFor, matchService, norm } from '../scripts/resolveRailwayService.mjs';

const canvas = [
  { id: 'api', name: 'Atmosphere APIs' },
  { id: 'site', name: 'Corporate Website ' },
  { id: 'staff', name: 'Internal Growth Metrics ' },
  { id: 'office', name: 'Login & Dashboard ' },
];

test('norm collapses hyphens and padding so Atmosphere-web matches atmosphere web', () => {
  assert.equal(norm('Atmosphere-web'), 'atmosphere web');
  assert.equal(norm('Login & Dashboard '), 'login & dashboard');
});

test('aliasesFor(Atmosphere-web) includes Platform and the older Login & Dashboard name', () => {
  const names = aliasesFor('Atmosphere-web');
  assert.ok(names.has('atmosphere web'));
  assert.ok(names.has('login & dashboard'));
  assert.ok(names.has('platform'));
});

test('matchService maps old office and website names onto the live canvas', () => {
  assert.equal(matchService('Atmosphere-web', canvas)?.id, 'office');
  assert.equal(matchService('Login & Dashboard', canvas)?.id, 'office');
  assert.equal(matchService('Platform', canvas)?.id, 'office');
  assert.equal(matchService('website', canvas)?.id, 'site');
  assert.equal(matchService('Corporate Website', canvas)?.id, 'site');
  assert.equal(matchService('Atmosphere-internal', canvas)?.id, 'staff');
  assert.equal(matchService('Atmosphere APIs', canvas)?.id, 'api');
});

test('matchService maps office aliases onto the current Platform service', () => {
  const live = [
    { id: 'api', name: 'Atmosphere APIs' },
    { id: 'office', name: 'Platform' },
    { id: 'site', name: 'Corporate Website' },
  ];
  assert.equal(matchService('Login & Dashboard', live)?.id, 'office');
  assert.equal(matchService('Atmosphere-web', live)?.id, 'office');
  assert.equal(matchService('Platform', live)?.id, 'office');
});

test('matchService maps Field Capture aliases onto the leftover capture service', () => {
  const withField = [...canvas, { id: 'fc', name: 'Field Capture' }];
  assert.equal(matchService('Field Capture', withField)?.id, 'fc');
  assert.equal(matchService('fieldcapture', withField)?.id, 'fc');
  assert.equal(matchService('field-capture', withField)?.id, 'fc');
});
