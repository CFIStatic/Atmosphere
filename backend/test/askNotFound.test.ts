import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHonestNotFound, formatHonestNotFound } from '../src/shared/askNotFound.js';
import { rememberAskSearchMeta } from '../src/shared/askRetrievalContext.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const catalog: AskLookupCatalog = {
  orgId: 'o',
  jobId: 'j',
  access: 'org',
  jobTitle: 'Tiffany',
  clips: [{ proofId: 'p1', jobId: 'j', orgId: 'o', title: 'Office walk' }],
  people: [],
  history: [],
};

test('honest not-found names the search and what is on file', () => {
  rememberAskSearchMeta('j', { phrases: ['purple dumpster'], terms: ['purple'], clipCount: 1, hitCount: 0 });
  const text = formatHonestNotFound({ question: 'Is there a purple dumpster?', catalog });
  assert.match(text, /purple dumpster/i);
  assert.match(text, /1 clip/i);
  assert.match(text, /Tiffany|Office walk/);
});

test('applyHonestNotFound rewrites hedges only', () => {
  const ok = applyHonestNotFound('There are **2** clips on this job.', catalog, 'how many');
  assert.equal(ok.startsWith('There are'), true);
  const hedged = applyHonestNotFound('Nothing on this file matches that.', catalog, 'purple?');
  assert.match(hedged, /Searched for|looked through/i);
});
