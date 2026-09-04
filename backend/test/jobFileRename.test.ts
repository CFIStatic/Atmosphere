import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/lib/errors.ts';
import {
  isOpaqueJobWriteError,
  renameCrmJobTitle,
  renameJobFileError,
} from '../src/lib/jobFileRename.ts';

test('isOpaqueJobWriteError hides PostgREST and leftover-trigger wording', () => {
  assert.equal(isOpaqueJobWriteError('Forbidden'), true);
  assert.equal(isOpaqueJobWriteError('permission denied for table crm_jobs'), true);
  assert.equal(isOpaqueJobWriteError('new row violates row-level security policy'), true);
  assert.equal(isOpaqueJobWriteError('relation "public.crm_audit_log" does not exist'), true);
  assert.equal(isOpaqueJobWriteError('Job name is too short'), false);
});

test('renameJobFileError never returns Forbidden to the office', () => {
  const err = renameJobFileError({ message: 'Forbidden' });
  assert.equal(err.status, 400);
  assert.equal(err.code, 'rename_failed');
  assert.match(err.message, /could not rename that job file/i);
  assert.doesNotMatch(err.message, /forbidden/i);
});

test('renameCrmJobTitle writes the title through the admin writer', async () => {
  const calls: string[] = [];
  const writer = {
    from(table: string) {
      assert.equal(table, 'crm_jobs');
      calls.push('update');
      const api = {
        update(row: { title: string }) {
          assert.equal(row.title, 'Mobil test one 1111');
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
          return Promise.resolve({
            data: {
              id: 'job-1',
              job_number: 12,
              title: 'Mobil test one 1111',
              status: 'scheduled',
              claim_number: null,
            },
            error: null,
          });
        },
      };
      return api;
    },
  };

  const row = await renameCrmJobTitle(writer, {
    orgId: 'org-1',
    jobId: 'job-1',
    title: 'Mobil test one 1111',
  });
  assert.equal(row.title, 'Mobil test one 1111');
  assert.equal(calls.length, 1);
});

test('renameCrmJobTitle maps a Forbidden write to a readable error', async () => {
  const writer = {
    from() {
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
          return Promise.resolve({ data: null, error: { message: 'Forbidden' } });
        },
      };
      return api;
    },
  };

  await assert.rejects(
    () =>
      renameCrmJobTitle(writer, {
        orgId: 'org-1',
        jobId: 'job-1',
        title: 'Kitchen rebuild',
      }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.code, 'rename_failed');
      assert.match(err.message, /could not rename that job file/i);
      return true;
    },
  );
});
