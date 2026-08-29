import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageBilling,
  isGlobalAdmin,
  labelForMemberRole,
  toOrgProductRole,
} from '../src/lib/productRoles.js';

test('legacy office_manager is Global Admin', () => {
  assert.equal(toOrgProductRole('office_manager'), 'global_admin');
  assert.equal(isGlobalAdmin('office_manager'), true);
  assert.equal(canManageBilling('office_manager'), true);
});

test('legacy crew roles are Employees without billing', () => {
  for (const role of ['field_technician', 'project_manager', 'accountant', 'sales', 'employee']) {
    assert.equal(toOrgProductRole(role), 'employee');
    assert.equal(canManageBilling(role), false);
  }
});

test('labels collapse legacy names onto product seats', () => {
  assert.equal(labelForMemberRole('field_technician'), 'Employee');
  assert.equal(labelForMemberRole('global_admin'), 'Global Admin');
});
