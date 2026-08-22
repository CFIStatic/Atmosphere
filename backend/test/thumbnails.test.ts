import test from 'node:test';
import assert from 'node:assert/strict';
import { attachThumbnailUrls, pickPreviewFrame } from '../src/verifier/thumbnails.js';

/**
 * The Dashboard list must show a frame from the clip. These tests cover the
 * pure picking and the URL attachment against a fake storage client — the
 * FFmpeg extract itself is covered in sparseExtract.test.ts.
 */

function fakeAdmin(opts: {
  frames: Array<{ proof_id: string; at_seconds: number; storage_path: string }>;
  signed: Record<string, string>;
}) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return Promise.resolve({ data: opts.frames, error: null });
        },
      };
    },
    storage: {
      from() {
        return {
          createSignedUrls(paths: string[]) {
            return Promise.resolve({
              data: paths.map((path) => ({
                path,
                signedUrl: opts.signed[path] ?? null,
                error: null,
              })),
              error: null,
            });
          },
        };
      },
    },
  };
}

test('attachThumbnailUrls signs the still closest to a quarter of the way in', async () => {
  const items = [
    { id: 'p1', durationSeconds: 60, thumbnailUrl: null as string | null },
    { id: 'p2', durationSeconds: 12, thumbnailUrl: null as string | null },
    { id: 'p3', durationSeconds: 8, thumbnailUrl: null as string | null },
  ];
  await attachThumbnailUrls(items, {
    client: fakeAdmin({
      frames: [
        { proof_id: 'p1', at_seconds: 0, storage_path: 'a/open.jpg' },
        { proof_id: 'p1', at_seconds: 1, storage_path: 'a/early.jpg' },
        { proof_id: 'p1', at_seconds: 18, storage_path: 'a/work.jpg' },
        { proof_id: 'p2', at_seconds: 3, storage_path: 'b/mid.jpg' },
      ],
      signed: {
        'a/work.jpg': 'https://cdn.example/work.jpg',
        'b/mid.jpg': 'https://cdn.example/mid.jpg',
      },
    }),
  });
  assert.equal(items[0].thumbnailUrl, 'https://cdn.example/work.jpg');
  assert.equal(items[1].thumbnailUrl, 'https://cdn.example/mid.jpg');
  assert.equal(items[2].thumbnailUrl, null);
});

test('attachThumbnailUrls leaves the library intact when storage has no stills', async () => {
  const items = [{ id: 'p1', durationSeconds: 20, thumbnailUrl: null as string | null }];
  await attachThumbnailUrls(items, {
    client: fakeAdmin({ frames: [], signed: {} }),
  });
  assert.equal(items[0].thumbnailUrl, null);
});

test('pickPreviewFrame on a single opening still still returns it', () => {
  assert.equal(pickPreviewFrame([{ atSeconds: 0, path: 'only.jpg' }], 45)?.path, 'only.jpg');
});
