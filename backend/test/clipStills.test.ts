import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadClipStills, pickStillSeconds } from '../src/shared/clipStills.js';

test('pickStillSeconds: nearest to a second, or spread over the clip', () => {
  assert.deepEqual(pickStillSeconds([0, 5, 10, 15, 20, 25], 11, 2), [10, 15]);
  assert.deepEqual(pickStillSeconds([0, 5, 10, 15, 20, 25], null, 3), [0, 15, 25]);
  assert.deepEqual(pickStillSeconds([4, 8], null, 4), [4, 8]);
  assert.equal(pickStillSeconds([1, 2, 3, 4, 5, 6, 7], null, 9).length, 4);
});

test('loadClipStills: never returns a still inside a private moment or child range (padded)', async () => {
  const downloaded: string[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [
              { at_seconds: 2, storage_path: 'a/f2.jpg' },
              { at_seconds: 10, storage_path: 'a/f10.jpg' },
              { at_seconds: 21, storage_path: 'a/f21.jpg' },
              { at_seconds: 30, storage_path: 'a/f30.jpg' },
            ],
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloaded.push(path);
          return { data: new Blob([Buffer.from(path)]), error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  const got = await loadClipStills(
    admin,
    {
      proofId: 'p1',
      // 11-20 private (padding reaches 9-21.5), so 10 and 21 are both out.
      privacyRedactions: [{ startSec: 11, endSec: 20, reason: 'private' }],
    },
    { atSeconds: 15, count: 4 },
  );
  assert.deepEqual(got.stills.map((s) => s.atSeconds), [2, 30]);
  assert.equal(got.privateSkipped, 2);
  assert.equal(got.onFile, 4);
  assert.deepEqual(downloaded, ['a/f2.jpg', 'a/f30.jpg']);
});
