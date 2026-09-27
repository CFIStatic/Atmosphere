import test from 'node:test';
import assert from 'node:assert/strict';
import {
  needsPlayableDerivative,
  playableDerivativePath,
  createSignedPlayableProofUrl,
  mp4HeaderHasFastStart,
  PROOF_PLAYABLE_SUFFIX,
  PROOF_PLAYBACK_URL_TTL_SECONDS,
} from '../src/lib/proofPlayableUrl.js';
import { canonicalProofContentType, contentTypeForProofPath } from '../src/lib/proofMediaType.js';

test('playableDerivativePath points every video at a .play.mp4 sibling', () => {
  assert.equal(
    playableDerivativePath('org/job/party/clip.webm'),
    `org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`,
  );
  assert.equal(playableDerivativePath('org/job/party/clip.WEBM'), `org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(playableDerivativePath('org/job/party/clip.mp4'), `org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(playableDerivativePath('org/job/party/clip.mov'), `org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(playableDerivativePath(`org/job/party/clip${PROOF_PLAYABLE_SUFFIX}`), null);
  assert.equal(playableDerivativePath(''), null);
  assert.equal(needsPlayableDerivative('a/b.webm'), true);
  assert.equal(needsPlayableDerivative('a/b.mp4'), true);
  assert.equal(needsPlayableDerivative(`a/b${PROOF_PLAYABLE_SUFFIX}`), false);
  assert.equal(PROOF_PLAYBACK_URL_TTL_SECONDS, 3600);
});

test('mp4HeaderHasFastStart requires moov ahead of mdat', () => {
  assert.equal(mp4HeaderHasFastStart(Buffer.from('xxxxftypisommoov')), true);
  assert.equal(mp4HeaderHasFastStart(Buffer.from('xxxxmdatxxxxmoov')), false);
  assert.equal(mp4HeaderHasFastStart(Buffer.from('not a video')), false);
});

test('canonicalProofContentType strips codec parameters', () => {
  assert.equal(canonicalProofContentType('video/webm;codecs=vp9,opus'), 'video/webm');
  assert.equal(canonicalProofContentType('video/mp4'), 'video/mp4');
  assert.equal(canonicalProofContentType('application/octet-stream'), null);
  assert.equal(contentTypeForProofPath('org/job/clip.webm'), 'video/webm');
  assert.equal(contentTypeForProofPath('org/job/clip.play.mp4'), 'video/mp4');
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
    awaitBuild: true,
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
    awaitBuild: true,
    runner: async () => ({ stdout: '', stderr: 'boom', code: 1 }),
  });

  assert.equal(result.derived, false);
  assert.equal(result.storagePath, 'org/job/clip.webm');
  assert.equal(result.url, `https://storage.test/org/job/clip.webm?e=${PROOF_PLAYBACK_URL_TTL_SECONDS}`);
  assert.equal(result.contentType, 'video/webm');
});

test('createSignedPlayableProofUrl prefers an existing mp4 derivative without waiting on ffmpeg', async () => {
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
    storagePath: 'org/job/raw.mp4',
    runner: async () => {
      runnerCalls += 1;
      return { stdout: '', stderr: '', code: 1 };
    },
  });

  assert.equal(result.derived, true);
  assert.equal(result.storagePath, `org/job/raw${PROOF_PLAYABLE_SUFFIX}`);
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(runnerCalls, 0);
});

test('createSignedPlayableProofUrl returns the original immediately when the derivative is missing', async () => {
  let runnerCalls = 0;
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
            throw new Error('should not upload on the view path');
          },
        };
      },
    },
  } as any;

  const result = await createSignedPlayableProofUrl({
    admin,
    storagePath: 'org/job/clip.webm',
    scheduleBuild: false,
    runner: async () => {
      runnerCalls += 1;
      return { stdout: '', stderr: '', code: 0 };
    },
  });

  assert.equal(result.derived, false);
  assert.equal(result.storagePath, 'org/job/clip.webm');
  assert.equal(result.expiresInSeconds, PROOF_PLAYBACK_URL_TTL_SECONDS);
  assert.equal(runnerCalls, 0);
});
