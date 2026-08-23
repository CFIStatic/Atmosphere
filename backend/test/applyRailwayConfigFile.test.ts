import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenConnection,
  matchEnvironment,
  normalizeConfigFile,
  sameConfigFile,
} from '../scripts/applyRailwayConfigFile.mjs';

test('normalizeConfigFile drops the leading slash the dashboard shows', () => {
  assert.equal(normalizeConfigFile('/website/railway.toml'), 'website/railway.toml');
  assert.equal(normalizeConfigFile(' website/railway.toml '), 'website/railway.toml');
  assert.equal(normalizeConfigFile(undefined), '');
});

test('sameConfigFile treats both spellings as already applied', () => {
  assert.equal(sameConfigFile('/website/railway.toml', 'website/railway.toml'), true);
  assert.equal(sameConfigFile(null, 'website/railway.toml'), false);
  // An unset Config File is what makes the service build the backend Dockerfile.
  assert.equal(sameConfigFile(null, ''), true);
});

test('flattenConnection reads both the edges shape and a plain array', () => {
  assert.deepEqual(flattenConnection({ edges: [{ node: { id: 'a' } }, {}] }), [{ id: 'a' }]);
  assert.deepEqual(flattenConnection([{ id: 'b' }]), [{ id: 'b' }]);
  assert.deepEqual(flattenConnection(null), []);
});

test('matchEnvironment prefers the named environment over the only one', () => {
  const environments = [
    { id: 'env-prod', name: 'production' },
    { id: 'env-stg', name: 'staging' },
  ];
  assert.equal(matchEnvironment('production', environments)?.id, 'env-prod');
  assert.equal(matchEnvironment('env-stg', environments)?.id, 'env-stg');
  assert.equal(matchEnvironment('nope', environments), null);
  assert.equal(matchEnvironment('nope', [{ id: 'only', name: 'production' }])?.id, 'only');
  assert.equal(matchEnvironment('production', []), null);
});
