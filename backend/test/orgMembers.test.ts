import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMemberRemoval } from '../src/org/members.js';

/**
 * Unlinking a login from the office account. The Settings list puts a
 * Remove control on every row except yours; these cases are the ones the
 * button must not be able to sneak past.
 */

test('a Global Admin can remove an Employee', () => {
  const decision = decideMemberRemoval({
    callerUserId: 'admin-1',
    callerRole: 'global_admin',
    targetUserId: 'crew-1',
    targetRole: 'employee',
    adminCountInOrg: 1,
  });
  assert.deepEqual(decision, { allowed: true });
});

test('a legacy office_manager seat can remove someone — it is a Global Admin', () => {
  const decision = decideMemberRemoval({
    callerUserId: 'admin-1',
    callerRole: 'office_manager',
    targetUserId: 'crew-1',
    targetRole: 'field_technician',
    adminCountInOrg: 1,
  });
  assert.deepEqual(decision, { allowed: true });
});

test('an Employee cannot remove anyone', () => {
  const decision = decideMemberRemoval({
    callerUserId: 'crew-1',
    callerRole: 'employee',
    targetUserId: 'crew-2',
    targetRole: 'employee',
    adminCountInOrg: 1,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.status, 403);
    assert.equal(decision.code, 'insufficient_role');
  }
});

test('you cannot remove your own login', () => {
  const decision = decideMemberRemoval({
    callerUserId: 'admin-1',
    callerRole: 'global_admin',
    targetUserId: 'admin-1',
    targetRole: 'global_admin',
    adminCountInOrg: 1,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.status, 400);
    assert.equal(decision.code, 'cannot_remove_self');
  }
});

test('the last Global Admin cannot be removed', () => {
  const decision = decideMemberRemoval({
    callerUserId: 'admin-1',
    callerRole: 'global_admin',
    targetUserId: 'admin-2',
    targetRole: 'global_admin',
    adminCountInOrg: 1,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.status, 409);
    assert.equal(decision.code, 'last_admin');
  }
});

test('one Global Admin can remove another when a second remains', () => {
  const decision = decideMemberRemoval({
    callerUserId: 'admin-1',
    callerRole: 'global_admin',
    targetUserId: 'admin-2',
    targetRole: 'office_manager',
    adminCountInOrg: 2,
  });
  assert.deepEqual(decision, { allowed: true });
});
