import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableRailwayOutput,
  railwayBackoffMs,
  INITIAL_RAILWAY_DELAY_MS,
  MAX_RAILWAY_ATTEMPTS,
} from '../scripts/syncGithubEnvToRailway.mjs';

test('Railway GraphQL timeouts are retried so Keys sync can finish', () => {
  assert.equal(
    isRetryableRailwayOutput(
      'Failed to fetch: error sending request for url (https://backboard.railway.com/graphql/v2)\noperation timed out',
    ),
    true,
  );
  assert.equal(isRetryableRailwayOutput('error sending request for url'), true);
  assert.equal(isRetryableRailwayOutput('Failed to fetch'), true);
});

test('auth and argument errors are not retried', () => {
  assert.equal(isRetryableRailwayOutput('Unauthorized'), false);
  assert.equal(isRetryableRailwayOutput('variable name is required'), false);
  assert.equal(isRetryableRailwayOutput(''), false);
});

test('backoff is 4s, 8s, 16s, 32s', () => {
  assert.equal(railwayBackoffMs(1), INITIAL_RAILWAY_DELAY_MS);
  assert.equal(railwayBackoffMs(2), 8000);
  assert.equal(railwayBackoffMs(3), 16000);
  assert.equal(railwayBackoffMs(4), 32000);
  assert.equal(MAX_RAILWAY_ATTEMPTS, 5);
});
