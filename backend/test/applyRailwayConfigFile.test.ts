import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuid, pickEnvironment, readGraphql } from '../scripts/applyRailwayConfigFile.mjs';

test('isUuid separates a resolved service id from a canvas name', () => {
  assert.equal(isUuid('d0af58bd-0eec-431d-bad3-4da4b4a2e2ae'), true);
  assert.equal(isUuid(' d0af58bd-0eec-431d-bad3-4da4b4a2e2ae '), true);
  assert.equal(isUuid('Corporate Website'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(undefined), false);
});

test('readGraphql treats a 200 carrying errors as a failure', () => {
  // Railway answers a rejected mutation with HTTP 200 and an errors array, so
  // a transport-only check would report the config file as set when it is not.
  const result = readGraphql({ errors: [{ message: 'Not Authorized' }], data: null });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /Not Authorized/);
});

test('readGraphql rejects a body with no data field', () => {
  assert.equal(readGraphql({}).ok, false);
  assert.equal(readGraphql(null).ok, false);
});

test('readGraphql passes a clean response through', () => {
  const result = readGraphql({ data: { serviceInstanceUpdate: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { serviceInstanceUpdate: true });
});

test('pickEnvironment matches the environment by name, case-insensitively', () => {
  const data = {
    environments: {
      edges: [
        { node: { id: 'env-staging', name: 'staging' } },
        { node: { id: 'env-prod', name: 'Production' } },
      ],
    },
  };
  assert.equal(pickEnvironment(data, 'production')?.id, 'env-prod');
  assert.equal(pickEnvironment(data, 'staging')?.id, 'env-staging');
  assert.equal(pickEnvironment(data, 'nope'), null);
});

test('pickEnvironment survives an empty or malformed environment list', () => {
  assert.equal(pickEnvironment({ environments: { edges: [] } }, 'production'), null);
  assert.equal(pickEnvironment({}, 'production'), null);
  assert.equal(pickEnvironment({ environments: { edges: [{ node: null }] } }, 'production'), null);
});
