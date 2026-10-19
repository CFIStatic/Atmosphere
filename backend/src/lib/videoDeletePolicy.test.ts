import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { assertGlobalAdminCanDeleteVideo, isHiddenVideo } from './videoDeletePolicy.js';
import { HttpError } from './errors.js';

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

test('delete only hides a clip; bytes are kept', () => {
  assert.equal(isHiddenVideo({ deleted_at: null }), false);
  assert.equal(isHiddenVideo({ deleted_at: '2026-10-19T14:00:00Z' }), true);
});

test('no worker permanently purges evidence', () => {
  const srcDir = new URL('..', import.meta.url);
  assert.equal(existsSync(new URL('shared/proofPurgeSweep.ts', srcDir)), false);
  const index = readFileSync(new URL('index.ts', srcDir), 'utf8');
  assert.doesNotMatch(index, /PurgeSweep/);
});
