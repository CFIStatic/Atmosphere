import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOB_FILE_DELETED_EVENT,
  JOB_FILE_DELETED_RPC_EVENT,
  isCrmAuditLogMissingError,
  isJobFileDeletedEvent,
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

test('isJobFileDeletedEvent accepts both ledger spellings', () => {
  assert.equal(isJobFileDeletedEvent(JOB_FILE_DELETED_EVENT), true);
  assert.equal(isJobFileDeletedEvent(JOB_FILE_DELETED_RPC_EVENT), true);
  assert.equal(isJobFileDeletedEvent('job.created'), false);
});

test('listTombstonedJobIds reads job_id and entity_id from delete events', async () => {
  const calls: unknown[] = [];
  const writer = {
    from(table: string) {
      assert.equal(table, 'memory_events');
      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          calls.push(['eq', col, val]);
          return api;
        },
        in(col: string, val: unknown) {
          calls.push(['in', col, val]);
          return api;
        },
        limit() {
          return Promise.resolve({
            data: [
              { job_id: 'job-1', entity_id: 'job-1', event_type: JOB_FILE_DELETED_EVENT },
              { job_id: null, entity_id: 'job-2', event_type: JOB_FILE_DELETED_RPC_EVENT },
              { job_id: null, entity_id: null, event_type: JOB_FILE_DELETED_EVENT },
            ],
            error: null,
          });
        },
      };
      return api;
    },
  };

  const ids = await listTombstonedJobIds(writer, 'org-1');
  assert.deepEqual([...ids].sort(), ['job-1', 'job-2']);
  assert.deepEqual(calls[0], ['eq', 'org_id', 'org-1']);
  assert.deepEqual(calls[1], [
    'in',
    'event_type',
    [JOB_FILE_DELETED_EVENT, JOB_FILE_DELETED_RPC_EVENT],
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
    title: 'Cursor 1',
    actorId: 'user-1',
  });

  assert.equal(inserted?.event_type, JOB_FILE_DELETED_EVENT);
  assert.equal(inserted?.job_id, 'job-1');
  assert.equal(inserted?.entity_id, 'job-1');
  assert.equal(inserted?.source, 'app');
  assert.match(String(inserted?.summary), /Cursor 1/);
});

test('writeJobFileDeleteTombstone falls back to record_memory_event', async () => {
  let rpcArgs: Record<string, unknown> | null = null;
  const writer = {
    from(table: string) {
      assert.equal(table, 'memory_events');
      return {
        insert() {
          return Promise.resolve({
            error: { message: 'permission denied for table memory_events' },
          });
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      assert.equal(fn, 'record_memory_event');
      rpcArgs = args;
      return Promise.resolve({ error: null });
    },
  };

  await writeJobFileDeleteTombstone(writer, {
    orgId: 'org-1',
    jobId: 'job-1',
    title: 'Cursor 1',
    actorId: 'user-1',
  });

  assert.equal(rpcArgs?.p_event_type, JOB_FILE_DELETED_RPC_EVENT);
  assert.equal(rpcArgs?.p_entity_id, 'job-1');
  assert.equal(rpcArgs?.p_job_id, null);
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
