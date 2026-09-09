import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeChunkedProofUpload,
  createPartUploadUrl,
  createUploadUrl,
} from '../src/routes/proofOfWork.js';

function memoryAdmin(existing: Record<string, Buffer> = {}) {
  const objects = { ...existing };
  let downloads = 0;
  return {
    objects,
    get downloads() {
      return downloads;
    },
    storage: {
      from() {
        return {
          createSignedUploadUrl: async (path: string) => ({
            data: { signedUrl: `https://storage.test/upload/${path}`, token: `t-${path}` },
            error: null,
          }),
          list: async (folder: string, opts?: { search?: string }) => {
            const prefix = folder ? `${folder}/` : '';
            const search = opts?.search || '';
            const data = Object.keys(objects)
              .filter((path) => path.startsWith(prefix))
              .map((path) => path.slice(prefix.length))
              .filter((name) => !name.includes('/') && (!search || name.includes(search)))
              .map((name) => ({
                name,
                metadata: { size: objects[prefix + name]?.length ?? 0 },
              }));
            return { data, error: null };
          },
          download: async (path: string) => {
            downloads += 1;
            const data = objects[path];
            if (!data) return { data: null, error: { message: 'missing' } };
            return { data, error: null };
          },
          upload: async (path: string, bytes: Buffer) => {
            objects[path] = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            for (const path of paths) delete objects[path];
            return { error: null };
          },
        };
      },
    },
  };
}

const party = { org_id: 'org-1', job_id: 'job-1', id: 'party-1' };

test('createUploadUrl mints part URLs for a resumable film', async () => {
  const admin = memoryAdmin();
  const slot = await createUploadUrl(party, admin, {
    workDate: '2026-09-05',
    phase: 'after',
    extension: 'webm',
    byteSize: 20 * 1024 * 1024,
  });
  assert.equal(slot.path, 'org-1/job-1/party-1/2026-09-05-after.webm');
  assert.ok(slot.uploadUrl.includes(slot.path));
  assert.ok(slot.parts);
  assert.equal(slot.parts?.length, 3);
  assert.equal(slot.parts?.[0].start, 0);
  assert.equal(slot.parts?.[2].end, 20 * 1024 * 1024 - 1);
});

test('completeChunkedProofUpload concatenates landed parts onto the final path', async () => {
  const path = 'org-1/job-1/party-1/2026-09-05-after.webm';
  const admin = memoryAdmin({
    [`${path}.parts/0000`]: Buffer.from('AAA'),
    [`${path}.parts/0001`]: Buffer.from('BBB'),
  });
  const out = await completeChunkedProofUpload(party, admin, {
    workDate: '2026-09-05',
    phase: 'after',
    storagePath: path,
    partCount: 2,
  });
  assert.equal(out.path, path);
  assert.equal(out.byteSize, 6);
  assert.equal(admin.objects[path].toString(), 'AAABBB');
  assert.equal(admin.objects[`${path}.parts/0000`], undefined);
});

test('completeChunkedProofUpload refuses an oversized part before concatenating', async () => {
  const path = 'org-1/job-1/party-1/2026-09-05-after.webm';
  const admin = memoryAdmin({
    [`${path}.parts/0000`]: Buffer.from('AAA'),
    [`${path}.parts/0001`]: Buffer.from('BBBBBB'),
  });
  await assert.rejects(
    () =>
      completeChunkedProofUpload(
        party,
        admin,
        {
          workDate: '2026-09-05',
          phase: 'after',
          storagePath: path,
          partCount: 2,
        },
        { maxBytes: 5 },
      ),
    /too large to assemble/i,
  );
  assert.equal(admin.objects[path], undefined);
  assert.equal(admin.downloads, 1, 'second part must not be downloaded after the budget is spent');
});

test('completeChunkedProofUpload does not download a part whose listed size already blows the cap', async () => {
  const path = 'org-1/job-1/party-1/2026-09-05-after.webm';
  const admin = memoryAdmin({
    [`${path}.parts/0000`]: Buffer.alloc(8),
    [`${path}.parts/0001`]: Buffer.alloc(8),
  });
  await assert.rejects(
    () =>
      completeChunkedProofUpload(
        party,
        admin,
        {
          workDate: '2026-09-05',
          phase: 'after',
          storagePath: path,
          partCount: 2,
        },
        { maxBytes: 4 },
      ),
    /too large to assemble/i,
  );
  assert.equal(admin.downloads, 0);
});

test('completeChunkedProofUpload refuses to invent a missing slice', async () => {
  const path = 'org-1/job-1/party-1/2026-09-05-after.webm';
  const admin = memoryAdmin({
    [`${path}.parts/0000`]: Buffer.from('AAA'),
  });
  await assert.rejects(
    () =>
      completeChunkedProofUpload(party, admin, {
        workDate: '2026-09-05',
        phase: 'after',
        storagePath: path,
        partCount: 2,
      }),
    /part 2 did not land/i,
  );
});

/* ---- upload while recording -------------------------------------------------
   The phone asks for one part URL at a time while the camera runs, PUTs each
   slice as it fills, and stitches at hold-to-finish. Parts live under the
   clip's own path, so the next film on the same job and day cannot collide. */

test('createUploadUrl carries the clip id into the object path', async () => {
  const admin = memoryAdmin();
  const slot = await createUploadUrl(party, admin, {
    workDate: '2026-09-09',
    phase: 'after',
    extension: 'webm',
    byteSize: 1024,
    clipId: 'mf3k9x2abc',
  });
  assert.equal(slot.path, 'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm');
  assert.equal(slot.clipId, 'mf3k9x2abc');
  assert.equal(slot.parts, undefined);
  const legacy = await createUploadUrl(party, admin, { workDate: '2026-09-09', phase: 'after', extension: 'webm' });
  assert.equal(legacy.path, 'org-1/job-1/party-1/2026-09-09-after.webm');
  assert.equal(legacy.clipId, null);
});

test('createPartUploadUrl mints one slice of a film that is still recording', async () => {
  const admin = memoryAdmin();
  const part = await createPartUploadUrl(party, admin, {
    workDate: '2026-09-09',
    phase: 'after',
    extension: 'webm',
    clipId: 'mf3k9x2abc',
    index: 3,
  });
  assert.equal(part.path, 'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm');
  assert.equal(part.partPath, 'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm.parts/0003');
  assert.ok(part.uploadUrl.endsWith(part.partPath));
  assert.equal(part.index, 3);
  assert.equal(part.maxParts, 128);
  assert.equal(part.assembleMaxBytes, 512 * 1024 * 1024);
  await assert.rejects(
    createPartUploadUrl(party, admin, { workDate: '2026-09-09', phase: 'after', extension: 'webm', index: 0 }),
    'a clip id is required so streamed slices can never collide with another film',
  );
  await assert.rejects(
    createPartUploadUrl(party, admin, {
      workDate: '2026-09-09',
      phase: 'after',
      extension: 'webm',
      clipId: 'mf3k9x2abc',
      index: 128,
    }),
    'upload-complete stitches at most 128 parts',
  );
});

test('completeChunkedProofUpload stitches streamed slices under a clip path', async () => {
  const path = 'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm';
  const admin = memoryAdmin({
    [`${path}.parts/0000`]: Buffer.from('AAAA'),
    [`${path}.parts/0001`]: Buffer.from('BB'),
    [`${path}.parts/0002`]: Buffer.from('C'),
    // Another film the same day keeps its own slices.
    ['org-1/job-1/party-1/2026-09-09-after-zzzzzz.webm.parts/0000']: Buffer.from('ZZZ'),
  });
  const out = await completeChunkedProofUpload(party, admin, {
    workDate: '2026-09-09',
    phase: 'after',
    storagePath: path,
    partCount: 3,
  });
  assert.equal(out.path, path);
  assert.equal(out.byteSize, 7);
  assert.equal(admin.objects[path].toString(), 'AAAABBC');
  assert.equal(admin.objects[`${path}.parts/0000`], undefined, 'stitched slices are removed');
  assert.equal(
    admin.objects['org-1/job-1/party-1/2026-09-09-after-zzzzzz.webm.parts/0000'].toString(),
    'ZZZ',
    "another clip's slices are untouched",
  );
});
