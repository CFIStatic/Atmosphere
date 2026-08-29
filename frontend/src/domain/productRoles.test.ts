import { describe, expect, it } from 'vitest';
import {
  canManageBilling,
  isGlobalAdmin,
  labelForMemberRole,
  PRODUCT_ROLE_LABELS,
  toOrgProductRole,
} from './productRoles';

describe('product roles', () => {
  it('maps legacy seats onto Global Admin and Employee', () => {
    expect(toOrgProductRole('office_manager')).toBe('global_admin');
    expect(toOrgProductRole('global_admin')).toBe('global_admin');
    expect(toOrgProductRole('field_technician')).toBe('employee');
    expect(toOrgProductRole('project_manager')).toBe('employee');
    expect(toOrgProductRole('employee')).toBe('employee');
  });

  it('gates billing to Global Admin only', () => {
    expect(canManageBilling('global_admin')).toBe(true);
    expect(canManageBilling('office_manager')).toBe(true);
    expect(canManageBilling('employee')).toBe(false);
    expect(canManageBilling('accountant')).toBe(false);
    expect(isGlobalAdmin('sales')).toBe(false);
  });

  it('labels product seats for the UI', () => {
    expect(labelForMemberRole('field_technician')).toBe(PRODUCT_ROLE_LABELS.employee);
    expect(labelForMemberRole('office_manager')).toBe(PRODUCT_ROLE_LABELS.global_admin);
    expect(PRODUCT_ROLE_LABELS.invited_worker).toBe('Invited worker');
  });
});
