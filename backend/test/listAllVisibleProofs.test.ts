import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_PROOF_PAGE, listAllVisibleProofs } from '../src/routes/proofOfWork.js';

function pagingAdmin(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ from: number; to: number; eqs: Record<string, unknown> }> = [];
  return {
    calls,
    from() {
      const eqs: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        is() {
          return builder;
        },
        eq(column: string, value: unknown) {
          eqs[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        async range(from: number, to: number) {
          calls.push({ from, to, eqs: { ...eqs } });
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return builder;
    },
  };
}

test('JOB_PROOF_PAGE is a fetch window, not a product cap', () => {
  assert.equal(JOB_PROOF_PAGE, 1000);
});

test('listAllVisibleProofs walks every page so a job file is not cut off at 200', async () => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({ id: `p${i}` }));
  const admin = pagingAdmin(rows);
  const out = await listAllVisibleProofs(admin, { orgId: 'org-1', jobId: 'job-1' });
  assert.equal(out.length, 1005, 'films past the first PostgREST page must still appear');
  assert.equal(admin.calls.length, 2);
  assert.deepEqual(admin.calls[0], {
    from: 0,
    to: 999,
    eqs: { org_id: 'org-1', job_id: 'job-1' },
  });
  assert.equal(admin.calls[1].from, 1000);
  assert.equal(admin.calls[1].to, 1999);
});

test('listAllVisibleProofs returns an empty library when nothing is filed', async () => {
  const admin = pagingAdmin([]);
  const out = await listAllVisibleProofs(admin, { partyId: 'party-1' });
  assert.deepEqual(out, []);
  assert.equal(admin.calls.length, 1);
  assert.equal(admin.calls[0].eqs.party_id, 'party-1');
});
