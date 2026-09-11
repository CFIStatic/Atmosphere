import assert from 'node:assert/strict';
import test from 'node:test';
import { permanentlyPurgeProof } from './proofPurgeSweep.js';

function adminStub(opts?: { framePaths?: string[]; failDelete?: boolean }) {
  const removed: string[][] = [];
  const deletedIds: string[] = [];
  return {
    removed,
    deletedIds,
    from(table: string) {
      const ctx: { id?: string; proofId?: string; deleting?: boolean } = {};
      const api: Record<string, unknown> = {};
      const chain = () => api;
      api.select = chain;
      api.eq = (col: string, val: unknown) => {
        if (col === 'id') ctx.id = String(val);
        if (col === 'proof_id') ctx.proofId = String(val);
        return api;
      };
      api.delete = () => {
        ctx.deleting = true;
        return api;
      };
      api.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          if (table === 'job_proof_frames') {
            return Promise.resolve(
              resolve({
                data: (opts?.framePaths ?? []).map((storage_path) => ({
                  storage_path,
                  proof_id: ctx.proofId,
                })),
                error: null,
              }),
            );
          }
          if (table === 'job_proofs' && ctx.deleting) {
            if (opts?.failDelete) {
              return Promise.resolve(resolve({ data: null, error: { message: 'boom' } }));
            }
            deletedIds.push(String(ctx.id));
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        } catch (err) {
          return Promise.resolve(reject ? reject(err) : undefined);
        }
      };
      return api;
    },
    storage: {
      from() {
        return {
          remove(paths: string[]) {
            removed.push(paths);
            return Promise.resolve({ data: paths, error: null });
          },
        };
      },
    },
  };
}

test('permanentlyPurgeProof removes storage + DB row after the window', async () => {
  const admin = adminStub({ framePaths: ['org/p1/frame.jpg'] });
  const result = await permanentlyPurgeProof(
    admin,
    {
      id: 'p1',
      org_id: 'o1',
      job_id: null,
      storage_path: 'org/p1/clip.mp4',
      legal_hold: false,
      scheduled_purge_at: '2026-08-01T00:00:00.000Z',
    },
    { now: new Date('2026-09-11T00:00:00.000Z'), recordAction: false },
  );
  assert.equal(result, 'purged');
  assert.deepEqual(admin.deletedIds, ['p1']);
  assert.ok(admin.removed[0].includes('org/p1/clip.mp4'));
  assert.ok(admin.removed[0].includes('org/p1/frame.jpg'));
});

test('permanentlyPurgeProof skips legal hold and unelapsed windows', async () => {
  const admin = adminStub();
  assert.equal(
    await permanentlyPurgeProof(
      admin,
      {
        id: 'p1',
        org_id: 'o1',
        job_id: null,
        storage_path: 'x',
        legal_hold: true,
        scheduled_purge_at: '2026-08-01T00:00:00.000Z',
      },
      { now: new Date('2026-09-11T00:00:00.000Z'), recordAction: false },
    ),
    'skipped_hold',
  );
  assert.equal(
    await permanentlyPurgeProof(
      admin,
      {
        id: 'p2',
        org_id: 'o1',
        job_id: null,
        storage_path: 'x',
        legal_hold: false,
        scheduled_purge_at: '2026-10-01T00:00:00.000Z',
      },
      { now: new Date('2026-09-11T00:00:00.000Z'), recordAction: false },
    ),
    'skipped_window',
  );
  assert.deepEqual(admin.deletedIds, []);
});
