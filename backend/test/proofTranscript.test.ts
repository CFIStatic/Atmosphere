import test from 'node:test';
import assert from 'node:assert/strict';
import { queueProofTranscript } from '../src/audio/proofTranscript.js';

test('queueProofTranscript marks the proof queued', async () => {
  const updates: unknown[] = [];
  const admin = {
    from: () => ({
      update: (row: unknown) => {
        updates.push(row);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  await queueProofTranscript(admin, 'proof-1');
  assert.deepEqual(updates[0], { transcript_status: 'queued' });
});

test('queueProofTranscript never throws into the upload path', async () => {
  const admin = {
    from: () => {
      throw new Error('db down');
    },
  };
  await assert.doesNotReject(() => queueProofTranscript(admin, 'proof-1'));
});
