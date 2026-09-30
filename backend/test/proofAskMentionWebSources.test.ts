/**
 * A mention briefing replaces a job-file answer the model did not write.
 * Web hits from that discarded search must not be stored with the mention answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJobAskMentionFallback } from '../src/routes/proofOfWork.js';
import { webSourcesFromHits, type AskWebHit } from '../src/shared/askWebSearch.js';

test('mention fallback clears web sources from the discarded job-file search', () => {
  const result = {
    answer: 'Plywood is about $40 a sheet.',
    model: null as string | null,
    webHits: [
      { title: 'Plywood', url: 'https://example.com/plywood', snippet: 'About $40 a sheet.' },
    ] as unknown[],
    webDerivedAnswer: true,
    answeredFromLookup: false,
  };
  const replaced = applyJobAskMentionFallback(result, {
    fallbackAnswer: 'John Cyganiak is on this job. That detail is not in the file.',
    directAnswer: null,
    mentions: [{ userId: 'john' }],
  });
  assert.equal(replaced, true);
  assert.match(result.answer, /John Cyganiak/);
  assert.equal(result.webDerivedAnswer, false);
  assert.deepEqual(webSourcesFromHits(result.webHits as AskWebHit[]), []);
});
