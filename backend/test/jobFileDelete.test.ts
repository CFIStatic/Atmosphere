import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOB_FILE_DELETED_EVENT,
  JOB_FILE_DELETED_RPC_EVENT,
  isCrmAuditLogMissingError,
  isJobFileDeletedEvent,
  jobLooksDeletedFromLibrary,
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
  assert.equal(isJobFileDeletedEvent('job.deleted'), true);
  assert.equal(isJobFileDeletedEvent('job.created'), false);
});

test('jobLooksDeletedFromLibrary matches the Job Files last-event line', () => {
  assert.equal(
    jobLooksDeletedFromLibrary('Job file “Cursor 1” deleted from the library.'),
    true,
  );
  assert.equal(jobLooksDeletedFromLibrary('opened job #5 — Cursor 1'), false);
});

test('listTombstonedJobIds reads job_id and entity_id from delete events', async () => {
  let orFilter = '';
  const writer = {
    from(table: string) {
      assert.equal(table, 'memory_events');
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        or(filter: string) {
          orFilter = filter;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return Promise.resolve({
            data: [
              { job_id: 'job-1', entity_id: 'job-1', event_type: JOB_FILE_DELETED_EVENT },
              { job_id: null, entity_id: 'job-2', event_type: JOB_FILE_DELETED_RPC_EVENT },
              {
                job_id: 'job-3',
                entity_id: 'job-3',
                event_type: 'job.updated',
                summary: 'Job file “Cursor 1” deleted from the library.',
              },
              { job_id: null, entity_id: null, event_type: JOB_FILE_DELETED_EVENT },
              { job_id: 'job-4', entity_id: 'job-4', event_type: 'job.created', summary: 'opened' },
            ],
            error: null,
          });
        },
      };
      return api;
    },
  };

  const ids = await listTombstonedJobIds(writer, 'org-1');
  assert.deepEqual([...ids].sort(), ['job-1', 'job-2', 'job-3']);
  assert.match(orFilter, /event_type\.eq\."job\.file_deleted"/);
  assert.match(orFilter, /event_type\.eq\."note\.file_deleted"/);
  assert.match(orFilter, /event_type\.eq\."job\.deleted"/);
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

test('softDeleteCrmJobRow skips crm_jobs when crm_audit_log is missing', async () => {
  let updates = 0;
  const writer = {
    from(table: string) {
      if (table === 'crm_audit_log') {
        return {
          select() {
            return {
              limit() {
                return Promise.resolve({
                  data: null,
                  error: { message: 'relation "public.crm_audit_log" does not exist' },
                });
              },
            };
          },
        };
      }
      assert.equal(table, 'crm_jobs');
      updates += 1;
      return {};
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
  assert.equal(updates, 0);
});
