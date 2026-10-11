import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unclaimedSharesForEmail } from '../src/shared/jobProgressGrants.js';

const share = (over: Partial<{ id: string; job_id: string; recipient_email: string | null; revoked_at: string | null; expires_at: string | null }> = {}) => ({
  id: 's1',
  job_id: 'job-1',
  recipient_email: 'Owner@Example.com',
  revoked_at: null,
  expires_at: null,
  ...over,
});

test('a new job shared with the same homeowner email joins their account', () => {
  const live = [{ job_id: 'job-1', share_id: 's1', revoked_at: null }];
  const todo = unclaimedSharesForEmail([share(), share({ id: 's2', job_id: 'job-2' })], live, 'owner@example.com');
  assert.deepEqual(todo.map((s) => s.job_id), ['job-2']);
});

test('revoked, expired or other-email invites never link', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const todo = unclaimedSharesForEmail(
    [
      share({ id: 'a', revoked_at: past }),
      share({ id: 'b', job_id: 'job-2', expires_at: past }),
      share({ id: 'c', job_id: 'job-3', recipient_email: 'someone@else.com' }),
    ],
    [],
    'owner@example.com',
  );
  assert.equal(todo.length, 0);
});

test('one grant per job (newest invite first) and a re-sent invite replaces a dead grant', () => {
  const todo = unclaimedSharesForEmail(
    [share({ id: 'new' }), share({ id: 'old' })],
    [{ job_id: 'job-1', share_id: 'old', revoked_at: '2026-10-01T00:00:00Z' }],
    'owner@example.com',
  );
  assert.deepEqual(todo.map((s) => s.id), ['new']);
});

test('grant lookups adopt invites to the signed-in email first; removing a person revokes every invite to that email', () => {
  const grants = readFileSync(new URL('../src/shared/jobProgressGrants.ts', import.meta.url), 'utf8');
  assert.match(grants, /await adoptSharesForEmail\(admin, userId, userEmail\);\n {2}const rows = await selectGrantRows\(admin, userId\);/);
  assert.match(grants, /await adoptSharesForEmail\(admin, userId, userEmail, jobId\);/);
  const revoke = readFileSync(new URL('../src/shared/revokeJobAccess.ts', import.meta.url), 'utf8');
  assert.equal((revoke.match(/await revokeProgressSharesForEmail\(/g) ?? []).length, 2);
});
