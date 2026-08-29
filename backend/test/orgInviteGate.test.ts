import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePendingOrgInvite } from '../src/lib/orgInviteGate.js';

test('join without an email is refused as invite_required', async () => {
  await assert.rejects(
    () => requirePendingOrgInvite({ joinCode: '8F3A9C2B', email: null }),
    (err: unknown) => {
      assert.ok(err && typeof err === 'object' && 'code' in err);
      assert.equal((err as { code: string }).code, 'invite_required');
      return true;
    },
  );
});

test('blank email is refused as invite_required', async () => {
  await assert.rejects(
    () => requirePendingOrgInvite({ joinCode: '8F3A9C2B', email: '   ' }),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'invite_required');
      return true;
    },
  );
});
