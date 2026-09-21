import test from 'node:test';
import assert from 'node:assert/strict';
import {
  needsPlayableDerivative,
  playableDerivativePath,
  createSignedPlayableProofUrl,
  PROOF_PLAYABLE_SUFFIX,
} from '../src/lib/proofPlayableUrl.js';

test('playableDerivativePath only rewrites .webm originals', () => {
  assert.equal(
    playableDerivativePath('org/job/party/clip.webm'),
    `org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`,
  );
  assert.equal(playableDerivativePath('org/job/party/clip.WEBM'), `org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(playableDerivativePath('org/job/party/clip.mp4'), null);
  assert.equal(playableDerivativePath('org/job/party/clip.mov'), null);
  assert.equal(playableDerivativePath(''), null);
  assert.equal(needsPlayableDerivative('a/b.webm'), true);
  assert.equal(needsPlayableDerivative('a/b.mp4'), false);
});

test('createSignedPlayableProofUrl signs mp4 originals without building a derivative', async () => {
  const calls: string[] = [];
  const admin = {
    storage: {
      from() {
        return {
          async createSignedUrl(path: string, expires: number) {
            calls.push(`sign:${path}:${expires}`);
            return { data: { signedUrl: `https://storage.test/${path}?e=${expires}` }, error: null };
          },
          async list() {
            throw new Error('list should not run for mp4');
          },
          async upload() {
            throw new Error('upload should not run for mp4');
          },
        };
      },
    },
  } as any;

  const result = await createSignedPlayableProofUrl({
    admin,
    storagePath: 'org/job/clip.mp4',
    expiresInSeconds: 600,
  });
  assert.equal(result.derived, false);
  assert.equal(result.storagePath, 'org/job/clip.mp4');
  assert.equal(result.url, 'https://storage.test/org/job/clip.mp4?e=600');
  assert.deepEqual(calls, ['sign:org/job/clip.mp4:600']);
});

test('createSignedPlayableProofUrl builds and signs .play.mp4 for webm', async () => {
  const uploads: Array<{ path: string; type: string; bytes: number }> = [];
  const listed = new Set<string>();
  const admin = {
    storage: {
      from() {
        return {
          async createSignedUrl(path: string, expires: number) {
            return { data: { signedUrl: `https://storage.test/${path}?e=${expires}` }, error: null };
          },
          async list(_folder: string, opts: { search?: string }) {
            const name = opts?.search ?? '';
            return {
              data: listed.has(name) ? [{ name }] : [],
              error: null,
            };
          },
          async upload(path: string, bytes: Buffer, opts: { contentType: string }) {
            uploads.push({ path, type: opts.contentType, bytes: bytes.length });
            listed.add(path.split('/').pop()!);
            return { error: null };
          },
        };
      },
    },
  } as any;

  const runner = async (_bin: string, args: string[]) => {
    const out = args[args.length - 1];
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(out), { recursive: true });
    // Minimal non-empty payload the helper will upload.
    await writeFile(out, Buffer.from('ftypisom-fake-mp4-bytes'));
    return { stdout: '', stderr: '', code: 0 };
  };

  const result = await createSignedPlayableProofUrl({
    admin,
    storagePath: 'org/job/party/day-after-clip.webm',
    expiresInSeconds: 600,
    runner,
  });

  assert.equal(result.derived, true);
  assert.equal(result.storagePath, `org/job/party/day-after-clip${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(result.url, `https://storage.test/org/job/party/day-after-clip${PROOF_PLAYABLE_SUFFIX}?e=600`);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.type, 'video/mp4');
  assert.ok((uploads[0]?.bytes ?? 0) > 0);
});

test('createSignedPlayableProofUrl reuses an existing .play.mp4 without ffmpeg', async () => {
  let runnerCalls = 0;
  const admin = {
    storage: {
      from() {
        return {
          async createSignedUrl(path: string, expires: number) {
            return { data: { signedUrl: `https://storage.test/${path}?e=${expires}` }, error: null };
          },
          async list(_folder: string, opts: { search?: string }) {
            const name = opts?.search ?? '';
            return {
              data: name.endsWith(PROOF_PLAYABLE_SUFFIX) ? [{ name }] : [],
              error: null,
            };
          },
          async upload() {
            throw new Error('should not upload when derivative exists');
          },
        };
      },
    },
  } as any;

  const result = await createSignedPlayableProofUrl({
    admin,
    storagePath: 'org/job/clip.webm',
    runner: async () => {
      runnerCalls += 1;
      return { stdout: '', stderr: '', code: 1 };
    },
  });

  assert.equal(result.derived, true);
  assert.equal(result.storagePath, `org/job/clip${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(runnerCalls, 0);
});

test('createSignedPlayableProofUrl falls back to original webm when ffmpeg fails', async () => {
  const admin = {
    storage: {
      from() {
        return {
          async createSignedUrl(path: string, expires: number) {
            return { data: { signedUrl: `https://storage.test/${path}?e=${expires}` }, error: null };
          },
          async list() {
            return { data: [], error: null };
          },
          async upload() {
            return { error: null };
          },
        };
      },
    },
  } as any;

  const result = await createSignedPlayableProofUrl({
    admin,
    storagePath: 'org/job/clip.webm',
    runner: async () => ({ stdout: '', stderr: 'boom', code: 1 }),
  });

  assert.equal(result.derived, false);
  assert.equal(result.storagePath, 'org/job/clip.webm');
  assert.equal(result.url, 'https://storage.test/org/job/clip.webm?e=600');
});
