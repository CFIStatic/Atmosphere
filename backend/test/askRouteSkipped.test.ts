import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fastAnswerNeedsDeepFallback,
  logAskRouteDecision,
  needsDeepEvidence,
  recentAskRouteDecisionsForTests,
  resetAskRouteLogForTests,
  routeAskQuestion,
} from '../src/shared/askRoute.js';

test('item 5: money/safety/dispute/date escalate to deep', () => {
  assert.equal(needsDeepEvidence('What dollar amount was quoted for the roof?'), true);
  assert.equal(needsDeepEvidence('Any safety hazards on the south slope?'), true);
  assert.equal(needsDeepEvidence('Is the carrier disputing coverage?'), true);
  assert.equal(needsDeepEvidence('What is the deadline to finish by Friday?'), true);
  assert.equal(routeAskQuestion({ question: 'What is the claim number?' }).route, 'fast');
});

test('item 5: low-confidence Fast answers need deep fallback', () => {
  assert.equal(
    fastAnswerNeedsDeepFallback('What did they say about the tarp?', 'I am not sure.', true),
    true,
  );
  assert.equal(
    fastAnswerNeedsDeepFallback('What is the claim number?', 'CLM-1 is on the job file.', false),
    false,
  );
});

test('item 5: skipped routes are logged with question and reason', async () => {
  resetAskRouteLogForTests();
  await logAskRouteDecision({
    orgId: '00000000-0000-4000-8000-000000000001',
    jobId: '00000000-0000-4000-8000-000000000002',
    question: 'Can you search Google?',
    route: 'skipped',
    reason: 'skipped_web_capability',
  });
  const rows = recentAskRouteDecisionsForTests();
  assert.equal(rows.at(-1)?.route, 'skipped');
  assert.equal(rows.at(-1)?.reason, 'skipped_web_capability');
  assert.match(rows.at(-1)?.question ?? '', /Google/);
});
