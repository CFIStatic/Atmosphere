import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureClaimCitations } from '../src/shared/askClaimCitations.js';
import type { TranscriptChunk } from '../src/shared/askTranscriptIndex.js';

const chunk: TranscriptChunk = {
  key: 'p1#0',
  proofId: 'p1',
  jobId: 'j1',
  orgId: 'o1',
  clipTitle: 'Office',
  workDate: '2026-09-21',
  seq: 0,
  startSec: 14.6,
  endSec: 16,
  text: 'We just have to switch to LedgerPro cloud.',
  speaker: 'Speaker 1',
  cite: 'video/j1/p1/office@15',
};

test('adds sources trailer when a bare fact has none', () => {
  const out = ensureClaimCitations('There are 2 clips on this job.', [chunk]);
  assert.match(out.answer, /sources:/i);
  assert.equal(out.claimsCited, 1);
});

test('leaves answers with sources alone', () => {
  const out = ensureClaimCitations('There are 2 clips.\n\u27e6sources: job\u27e7', [chunk]);
  assert.equal((out.answer.match(/sources:/gi) ?? []).length, 1);
});
