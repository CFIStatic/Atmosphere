import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adminForJob, adminForOrg, scopeAdminQuery, writerForOrg } from './scopedAdmin.js';

function fakeBuilder() {
  const calls: Array<[string, string]> = [];
  const builder = {
    eq(column: string, value: string) {
      calls.push([column, value]);
      return builder;
    },
    calls,
  };
  return builder;
}

describe('scopeAdminQuery', () => {
  it('always pins org_id', () => {
    const q = fakeBuilder();
    scopeAdminQuery(q, { orgId: 'org-1' });
    assert.deepEqual(q.calls, [['org_id', 'org-1']]);
  });

  it('adds job and party filters when present', () => {
    const q = fakeBuilder();
    scopeAdminQuery(q, { orgId: 'org-1', jobId: 'job-2', partyId: 'pty-3' });
    assert.deepEqual(q.calls, [
      ['org_id', 'org-1'],
      ['job_id', 'job-2'],
      ['party_id', 'pty-3'],
    ]);
  });
});

describe('adminForJob / adminForOrg', () => {
  it('from().select() applies the scope before the caller can forget', () => {
    const calls: Array<{ table: string; eqs: Array<[string, string]> }> = [];
    const admin = {
      from(table: string) {
        const eqs: Array<[string, string]> = [];
        const filter = {
          eq(column: string, value: string) {
            eqs.push([column, value]);
            return filter;
          },
        };
        calls.push({ table, eqs });
        return {
          select() {
            return filter;
          },
          update() {
            return filter;
          },
          delete() {
            return filter;
          },
        };
      },
    };

    const scoped = adminForJob(
      { orgId: 'org-1', jobId: 'job-2' },
      admin as never,
    );
    scoped.from('job_proofs').select('id');
    assert.equal(calls[0]?.table, 'job_proofs');
    assert.deepEqual(calls[0]?.eqs, [
      ['org_id', 'org-1'],
      ['job_id', 'job-2'],
    ]);

    const org = adminForOrg('org-9', admin as never);
    org.from('crm_jobs').select('id');
    assert.deepEqual(calls[1]?.eqs, [['org_id', 'org-9']]);
  });
});

describe('writerForOrg', () => {
  it('requires an org id before handing out the admin client', () => {
    const admin = {
      from(table: string) {
        const filter = { eq() { return filter; } };
        return { select: () => filter, update: () => filter, delete: () => filter, table };
      },
    };
    const scoped = writerForOrg('org-7', admin as never);
    assert.equal(scoped.scope.orgId, 'org-7');
    assert.equal(scoped.raw, admin);
  });
});
