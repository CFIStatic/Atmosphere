import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invalidateAskJobCache,
  resetAskJobCacheForTests,
  resolveAskJobSummary,
} from '../src/shared/askJobCache.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const catalog: AskLookupCatalog = {
  orgId: 'o',
  jobId: 'j-cache',
  access: 'org',
  jobTitle: 'Cache Job',
  clips: [{ proofId: 'p1', jobId: 'j-cache', orgId: 'o', title: 'A', summary: 'summary one' }],
  people: [],
  history: [],
};

test('job summary cache hits until invalidated', () => {
  resetAskJobCacheForTests();
  const first = resolveAskJobSummary(catalog);
  assert.equal(first.cacheHit, false);
  const second = resolveAskJobSummary(catalog);
  assert.equal(second.cacheHit, true);
  assert.equal(second.fingerprint, first.fingerprint);
  invalidateAskJobCache('j-cache');
  const third = resolveAskJobSummary(catalog);
  assert.equal(third.cacheHit, false);
});
