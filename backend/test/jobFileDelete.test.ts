import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOB_FILE_DELETED_EVENT,
  isCrmAuditLogMissingError,
  listTombstonedJobIds,
  softDeleteCrmJobRow,
  writeJobFileDeleteTombstone,
} from '../src/lib/jobFileDelete.ts';

test('isCrmAuditLogMissingError matches the production Postgres wording', () => {
  assert.equal(
    isCrmAuditLogMissingError('relation "public.crm_audit_log" does not exist'),
    true,
  );
  assert.equal(isCrmAuditLogMissingError('permission denied for table crm_jobs'), false);
});

test('listTombstonedJobIds reads job.file_deleted memory events', async () => {
  const calls: unknown[] = [];
  const writer = {
    from(table: string) {
      assert.equal(table, 'memory_events');
      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          calls.push([col, val]);
          return api;
        },
        not() {
          return api;
        },
        limit() {
          return Promise.resolve({
            data: [{ job_id: 'job-1' }, { job_id: 'job-2' }, { job_id: null }],
            error: null,
          });
        },
      };
      return api;
    },
  };

  const ids = await listTombstonedJobIds(writer, 'org-1');
  assert.deepEqual([...ids].sort(), ['job-1', 'job-2']);
  assert.deepEqual(calls, [
    ['org_id', 'org-1'],
    ['event_type', JOB_FILE_DELETED_EVENT],
  ]);
});

test('writeJobFileDeleteTombstone inserts an app-sourced memory event', async () => {
  let inserted: Record<string, unknown> | null = null;
  const writer = {
    from(table: string) {
      assert.equal(table, 'memory_events');
      return {
        insert(row: Record<string, unknown>) {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await writeJobFileDeleteTombstone(writer, {
    orgId: 'org-1',
    jobId: 'job-1',
    title: 'Cedar Ridge',
    actorId: 'user-1',
  });

  assert.equal(inserted?.event_type, JOB_FILE_DELETED_EVENT);
  assert.equal(inserted?.job_id, 'job-1');
  assert.equal(inserted?.source, 'app');
  assert.match(String(inserted?.summary), /Cedar Ridge/);
});

test('softDeleteCrmJobRow surfaces crm_audit_log_missing after a failed repair', async () => {
  let updates = 0;
  const writer = {
    from(table: string) {
      assert.equal(table, 'crm_jobs');
      const api = {
        update() {
          return api;
        },
        eq() {
          return api;
        },
        is() {
          return api;
        },
        select() {
          return api;
        },
        maybeSingle() {
          updates += 1;
          return Promise.resolve({
            data: null,
            error: { message: 'relation "public.crm_audit_log" does not exist' },
          });
        },
      };
      return api;
    },
  };

  await assert.rejects(
    () =>
      softDeleteCrmJobRow(writer, {
        orgId: 'org-1',
        jobId: 'job-1',
        userId: 'user-1',
        now: '2026-09-01T00:00:00.000Z',
      }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, 'crm_audit_log_missing');
      assert.match(err.message, /crm_audit_log/);
      return true;
    },
  );
  // First attempt + retry after repairCrmAuditTriggers (no admin client here).
  assert.equal(updates, 2);
});
