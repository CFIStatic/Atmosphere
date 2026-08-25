import assert from 'node:assert/strict';
import test from 'node:test';
import { proofUploadTransport } from '../src/lib/proofUploadTransport.js';

test('signed proof upload URLs use PUT without Supabase auth headers', () => {
  const signed =
    'https://proj.supabase.co/storage/v1/object/upload/sign/job-proofs/org/job/party/2026-08-05-after.mp4?token=abc';
  assert.deepEqual(proofUploadTransport(signed), {
    method: 'PUT',
    useSupabaseAuth: false,
  });
});

test('direct bucket fallback URLs use POST with Supabase auth headers', () => {
  const direct =
    'https://proj.supabase.co/storage/v1/object/job-proofs/org/job/party/2026-08-05-after.mp4';
  assert.deepEqual(proofUploadTransport(direct), {
    method: 'POST',
    useSupabaseAuth: true,
  });
});
