import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsSha256,
  summaryStateOf,
  transcriptSha256,
  visualEventsOf,
} from '../src/audio/summaryFreshness.ts';
import { staleSummaryReason } from '../src/lib/backfillStaleSummaries.ts';

const transcript = '[0:00] her entire life.\n[0:11] You know I love that girl.';
const narration = { entries: [{ atSeconds: 2, text: 'Phone held sideways inside a home' }] };
const actions = [{ atSeconds: 30, text: 'Walks into the kitchen' }];

function row(overrides: Record<string, unknown> = {}) {
  const findings = {
    conversation: {
      summary: 'Affectionate talk about a girl.',
      transcriptSha256: transcriptSha256(transcript),
      eventsSha256: eventsSha256({ narration, actions }),
    },
  };
  return {
    transcript_text: transcript,
    transcript_status: 'done',
    summary_status: 'done',
    summary_transcript_sha256: transcriptSha256(transcript),
    ai_findings: findings,
    narration,
    actions,
    ...overrides,
  };
}

test('visual events are canonical: whitespace and float noise do not change the version', () => {
  assert.deepEqual(visualEventsOf({ narration, actions }), [
    [2, 'Phone held sideways inside a home'],
    [30, 'Walks into the kitchen'],
  ]);
  assert.equal(
    eventsSha256({ narration: { entries: [{ atSeconds: 2.01, text: ' Phone held  sideways inside a home ' }] }, actions }),
    eventsSha256({ narration, actions }),
  );
});

test('one evidence record: a summary goes stale when the frames are re-read, not only the transcript', () => {
  assert.equal(summaryStateOf(row()), 'fresh');
  const reRead = row({ narration: { entries: [{ atSeconds: 4, text: 'Camera turns to the doorway' }] } });
  assert.equal(summaryStateOf(reRead), 'updating');
  assert.equal(staleSummaryReason(reRead), 'events_changed');
  // A new transcript still wins as the reason.
  assert.equal(staleSummaryReason(row({ transcript_text: `${transcript}\n[0:30] I think she farts.` })), 'hash_mismatch');
});

test('summaries stamped before events were versioned are judged on the transcript alone', () => {
  const legacy = row({
    ai_findings: { conversation: { summary: 'x', transcriptSha256: transcriptSha256(transcript) } },
    narration: { entries: [{ atSeconds: 9, text: 'Anything' }] },
  });
  assert.equal(summaryStateOf(legacy), 'fresh');
  assert.equal(staleSummaryReason(legacy), null);
});

test('callers that did not load events do not guess', () => {
  const { narration: _n, actions: _a, ...noEvents } = row({ narration: { entries: [] } });
  assert.equal(summaryStateOf(noEvents), 'fresh');
});

test('a stale, failed or contradicting summary is never served; the transcript stays', async () => {
  const { servableSummary, summaryStillProcessing } = await import('../src/audio/summaryServe.ts');
  const fresh = servableSummary(row());
  assert.equal(fresh.state, 'fresh');
  assert.ok(fresh.conversation);

  for (const status of ['stale', 'queued', 'running']) {
    const served = servableSummary(row({ summary_status: status }));
    assert.equal(served.state, 'updating');
    assert.equal(served.conversation, null);
    assert.equal(served.evidenceLog, null);
    assert.equal(summaryStillProcessing(served.state), true);
  }
  const failed = servableSummary(row({ summary_status: 'failed' }));
  assert.equal(failed.state, 'failed');
  assert.equal(failed.conversation, null);

  // "Only one line was spoken" over a five-line transcript (the Tiffany bug).
  const five = '[0:00] her entire life.\n[0:11] You know I love that girl.\n[0:30] I think she farts.\n[0:35] I love her so much.\n[0:38] I love that.';
  const contradicting = servableSummary({
    transcript_text: five,
    summary_status: 'done',
    ai_findings: { conversation: { summary: 'Only one line was spoken in this clip.', transcriptSha256: transcriptSha256(five) } },
  });
  assert.equal(contradicting.state, 'quarantined');
  assert.equal(contradicting.conversation, null);
});
