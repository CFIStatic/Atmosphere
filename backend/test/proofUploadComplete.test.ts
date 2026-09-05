import test from 'node:test';
import assert from 'node:assert/strict';
import { completeChunkedProofUpload, createUploadUrl } from '../src/routes/proofOfWork.js';

function memoryAdmin(existing: Record<string, Buffer> = {}) {
  const objects = { ...existing };
  return {
    objects,
    storage: {
      from() {
        return {
          createSignedUploadUrl: async (path: string) => ({
            data: { signedUrl: `https://storage.test/upload/${path}`, token: `t-${path}` },
            error: null,
          }),
          download: async (path: string) => {
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
