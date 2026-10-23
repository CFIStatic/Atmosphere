import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMemberRoleChange } from '../src/org/memberAccess.js';
import { decideMemberRemoval } from '../src/org/members.js';
import {
  effectivePermissionRole,
  isAdminPermission,
  productRoleForPermission,
  PERMISSION_ROLES,
} from '../src/lib/productRoles.js';
import { isViewerBlockedWrite } from '../src/lib/orgContext.js';
import { requireOrgOwner, setOrgOwnerLoaderForTests } from '../src/middleware/requireOrgOwner.js';

test('permission role: column wins; legacy rows keep their meaning', () => {
  assert.equal(effectivePermissionRole({ permission_role: 'viewer', role: 'global_admin' }), 'viewer');
  assert.equal(effectivePermissionRole({ role: 'global_admin' }), 'admin');
  assert.equal(effectivePermissionRole({ role: 'office_manager' }), 'admin');
  assert.equal(effectivePermissionRole({ role: 'employee' }), 'member');
  for (const r of PERMISSION_ROLES) {
    assert.equal(productRoleForPermission(r), isAdminPermission(r) ? 'global_admin' : 'employee');
  }
});

const base = { callerUserId: 'a', targetUserId: 'b', targetIsOwner: false };

test('only owner and admins change roles', () => {
  for (const caller of PERMISSION_ROLES) {
    const d = decideMemberRoleChange({ ...base, callerPermissionRole: caller, permissionRole: 'viewer' });
    assert.equal(d.allowed, isAdminPermission(caller), caller);
  }
});

test('the owner cannot be changed or demoted, nobody becomes owner, no self-change', () => {
  const owner = decideMemberRoleChange({ ...base, targetIsOwner: true, callerPermissionRole: 'admin', permissionRole: 'member' });
  assert.equal(!owner.allowed && owner.code, 'owner_locked');
  const make = decideMemberRoleChange({ ...base, callerPermissionRole: 'owner', permissionRole: 'owner' });
  assert.equal(!make.allowed && make.code, 'owner_role_reserved');
  const self = decideMemberRoleChange({ ...base, targetUserId: 'a', callerPermissionRole: 'admin', permissionRole: 'member' });
  assert.equal(!self.allowed && self.code, 'cannot_change_self');
});

test('removal: owner never removed, last admin kept, members/viewers cannot remove', () => {
  const r = (callerRole: string, over: object = {}) =>
    decideMemberRemoval({ callerUserId: 'a', callerRole, targetUserId: 'b', targetRole: 'employee', adminCountInOrg: 2, ...over });
  assert.equal(r('global_admin').allowed, true);
  assert.equal(r('employee').allowed, false);
  assert.equal(r('global_admin', { targetIsOwner: true }).allowed, false);
  assert.equal(r('global_admin', { targetRole: 'global_admin', adminCountInOrg: 1 }).allowed, false);
});

test('viewers are read-only except their own account', () => {
  assert.equal(isViewerBlockedWrite({ method: 'GET', originalUrl: '/api/jobs' }), false);
  assert.equal(isViewerBlockedWrite({ method: 'POST', originalUrl: '/api/jobs' }), true);
  assert.equal(isViewerBlockedWrite({ method: 'DELETE', originalUrl: '/api/org/members/x' }), true);
  assert.equal(isViewerBlockedWrite({ method: 'PATCH', originalUrl: '/api/org/me' }), false);
});

async function runGate(method: string, userId: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = { method, orgId: 'org', user: { id: userId } } as never;
    void requireOrgOwner(req, {} as never, (err?: unknown) => resolve(err ?? 'ok'));
  });
}

test('billing and usage stay the owner\'s alone (admins too are refused)', async () => {
  setOrgOwnerLoaderForTests(async () => 'owner');
  try {
    assert.equal(await runGate('GET', 'owner'), 'ok');
    assert.equal(await runGate('POST', 'owner'), 'ok');
    assert.notEqual(await runGate('GET', 'admin'), 'ok');
  } finally {
    setOrgOwnerLoaderForTests(null);
  }
});
