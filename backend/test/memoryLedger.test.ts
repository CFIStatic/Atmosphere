import test from 'node:test';
import assert from 'node:assert/strict';
import { isMemoryLedgerError, intakeWriteError } from '../src/lib/memoryLedger.js';

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
