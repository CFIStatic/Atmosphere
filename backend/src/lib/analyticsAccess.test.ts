import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowlistedAnalyticsScope, resolvedAnalyticsScope } from './analyticsAccess.js';

describe('analytics allowlist', () => {
  it('grants internal scope to jack@jettx.ai by default', () => {
    assert.equal(allowlistedAnalyticsScope('jack@jettx.ai'), 'internal');
    assert.equal(allowlistedAnalyticsScope('Jack@JettX.ai'), 'internal');
  });

  it('denies unrelated emails until an admin approves them', () => {
    assert.equal(allowlistedAnalyticsScope('stranger@example.com'), null);
    assert.equal(allowlistedAnalyticsScope(null), null);
  });

  it('resolves allowlisted emails without a request row', async () => {
    assert.equal(await resolvedAnalyticsScope('jack@jettx.ai'), 'internal');
    assert.equal(await resolvedAnalyticsScope('stranger@example.com'), null);
  });
});
