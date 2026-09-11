import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIDEO_DELETE_PENDING_MS,
  assertGlobalAdminCanDeleteVideo,
  isPendingPurge,
  purgeWindowElapsed,
  scheduledPurgeAt,
} from './videoDeletePolicy.js';
import { HttpError } from './errors.js';

test('scheduledPurgeAt is 30 days after the queue stamp', () => {
  const from = new Date('2026-09-11T12:00:00.000Z');
  const purge = new Date(scheduledPurgeAt(from));
  assert.equal(purge.getTime() - from.getTime(), VIDEO_DELETE_PENDING_MS);
});

test('only Global Admin (and legacy office_manager) may delete', () => {
  assert.doesNotThrow(() => assertGlobalAdminCanDeleteVideo('global_admin'));
  assert.doesNotThrow(() => assertGlobalAdminCanDeleteVideo('office_manager'));
  for (const role of [
    'employee',
    'field_technician',
    'project_manager',
    'sales',
    'accountant',
    null,
    undefined,
  ]) {
    assert.throws(
      () => assertGlobalAdminCanDeleteVideo(role),
      (err: unknown) => err instanceof HttpError && err.status === 403 && err.code === 'insufficient_role',
    );
  }
});

test('isPendingPurge requires both stamps', () => {
  assert.equal(isPendingPurge({ deleted_at: null, scheduled_purge_at: null }), false);
  assert.equal(isPendingPurge({ deleted_at: '2026-09-01T00:00:00Z', scheduled_purge_at: null }), false);
  assert.equal(
    isPendingPurge({
      deleted_at: '2026-09-01T00:00:00Z',
      scheduled_purge_at: '2026-10-01T00:00:00Z',
    }),
    true,
  );
});

test('purgeWindowElapsed time-travels against scheduled_purge_at', () => {
  const due = '2026-10-11T12:00:00.000Z';
  assert.equal(purgeWindowElapsed(due, new Date('2026-10-11T11:59:59.000Z')), false);
  assert.equal(purgeWindowElapsed(due, new Date('2026-10-11T12:00:00.000Z')), true);
  assert.equal(purgeWindowElapsed(null, new Date('2026-10-11T12:00:00.000Z')), false);
});
