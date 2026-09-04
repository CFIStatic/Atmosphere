import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attemptIntakeWrite,
  clientsToTry,
  isCrmAuditError,
  isJobCreateBlockingError,
  isMemoryLedgerError,
  isPrivilegeError,
  intakeWriteError,
} from '../src/lib/memoryLedger.js';

test('detects the production memory_events job FK error', () => {
  assert.equal(
    isMemoryLedgerError(
      'insert or update on table "memory_events" violates foreign key constraint "memory_events_job_id_fkey"',
    ),
    true,
  );
  assert.equal(isMemoryLedgerError('Could not save the address.'), false);
  assert.equal(isMemoryLedgerError(''), false);
});

test('detects leftover crm_audit_log writes that abort job create', () => {
  assert.equal(
    isCrmAuditError('relation "public.crm_audit_log" does not exist'),
    true,
  );
  assert.equal(isJobCreateBlockingError('relation "public.crm_audit_log" does not exist'), true);
  assert.equal(isCrmAuditError('Could not save the address.'), false);
});

test('intake write errors do not leak Postgres constraint names', () => {
  const err = intakeWriteError(
    {
      message:
        'insert or update on table "memory_events" violates foreign key constraint "memory_events_job_id_fkey"',
    },
    'Could not create the job.',
    'job_failed',
  );
  assert.equal(err.status, 500);
  assert.equal(err.code, 'job_failed');
  assert.match(err.message, /Could not create the job/);
  assert.doesNotMatch(err.message, /memory_events/);
});

test('intake write errors hide the dropped crm_audit_log relation', () => {
  const err = intakeWriteError(
    { message: 'relation "public.crm_audit_log" does not exist' },
    'Could not create the job.',
    'job_failed',
  );
  assert.equal(err.status, 500);
  assert.equal(err.code, 'job_failed');
  assert.match(err.message, /Could not create the job/);
  assert.doesNotMatch(err.message, /crm_audit_log/);
});

test('PostgREST Forbidden is a privilege error, never shown to the office', () => {
  assert.equal(isPrivilegeError('Forbidden'), true);
  assert.equal(isPrivilegeError('forbidden'), true);
  assert.equal(isJobCreateBlockingError('Forbidden'), true);
  const err = intakeWriteError({ message: 'Forbidden' }, 'Could not duplicate the job file.', 'job_failed');
  assert.equal(err.status, 500);
  assert.equal(err.message, 'Could not duplicate the job file.');
  assert.doesNotMatch(err.message, /forbidden/i);
});

test('clientsToTry uses the user JWT after the service role', () => {
  const admin = { kind: 'admin' };
  const user = { kind: 'user' };
  assert.deepEqual(clientsToTry(admin, user), [admin, user]);
  assert.deepEqual(clientsToTry(null, user), [user]);
  assert.deepEqual(clientsToTry(user, user), [user]);
});

test('attemptIntakeWrite falls back to the user client after Forbidden', async () => {
  const admin = { kind: 'admin' };
  const user = { kind: 'user' };
  const created = await attemptIntakeWrite(
    clientsToTry(admin, user),
    async (client) => {
      if (client === admin) return { data: null, error: { message: 'Forbidden' } };
      return { data: { id: 'job-copy', title: 'Copy of Mobil test one' }, error: null };
    },
    'Could not duplicate the job file.',
    'job_failed',
  );
  assert.deepEqual(created, { id: 'job-copy', title: 'Copy of Mobil test one' });
});
