import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { HttpError } from '../src/lib/errors.js';
import { parseJobAccessPersonId } from '../src/shared/revokeJobAccess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('parseJobAccessPersonId — share / grant / party uuids', () => {
  assert.deepEqual(
    parseJobAccessPersonId('share:11111111-1111-4111-8111-111111111111'),
    { kind: 'share', id: '11111111-1111-4111-8111-111111111111' },
  );
  assert.deepEqual(
    parseJobAccessPersonId('grant:22222222-2222-4222-8222-222222222222'),
    { kind: 'grant', id: '22222222-2222-4222-8222-222222222222' },
  );
  assert.deepEqual(
    parseJobAccessPersonId('party:33333333-3333-4333-8333-333333333333'),
    { kind: 'party', id: '33333333-3333-4333-8333-333333333333' },
  );
});

test('parseJobAccessPersonId — rejects junk', () => {
  assert.throws(() => parseJobAccessPersonId('share:not-a-uuid'), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.code, 'bad_person_id');
    return true;
  });
  assert.throws(() => parseJobAccessPersonId('evidence:11111111-1111-4111-8111-111111111111'));
});

test('sharedJobs mounts org-only access-roster revoke', () => {
  const src = readFileSync(join(root, 'src/routes/sharedJobs.ts'), 'utf8');
  assert.match(src, /\/shared\/:jobId\/access-roster\/revoke/);
  assert.match(src, /revokeJobAccessPerson/);
  assert.match(src, /requireOrgContext\(req\)/);
  assert.match(src, /personId/);
});

test('evidence share revoke drops progress grants', () => {
  const src = readFileSync(join(root, 'src/routes/evidencePortal.ts'), 'utf8');
  assert.match(src, /share_kind === 'progress'/);
  assert.match(src, /job_progress_grants/);
  assert.match(src, /\.delete\(\)/);
});
