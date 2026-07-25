import { describe, expect, it } from 'vitest';
import { ROLE_PROFILES, can, canSee, homeFor, isExecutive, isFieldFirst } from './permissions';
import type { Role } from './types';

const ALL_ROLES = Object.keys(ROLE_PROFILES) as Role[];

describe('role profiles', () => {
  it('gives every role a landing page it can actually see', () => {
    for (const role of ALL_ROLES) {
      const home = homeFor(role).replace('/', '') as Parameters<typeof canSee>[1];
      expect(canSee(role, home), `${role} cannot see its own home`).toBe(true);
    }
  });

  it('always includes settings so no role is trapped', () => {
    for (const role of ALL_ROLES) {
      expect(canSee(role, 'settings'), `${role} has no settings access`).toBe(true);
    }
  });
});

describe('field technician restrictions', () => {
  it('is field-first', () => {
    expect(isFieldFirst('field_technician')).toBe(true);
    expect(isFieldFirst('project_manager')).toBe(false);
  });

  it('cannot reach company money or the approvals queue', () => {
    expect(canSee('field_technician', 'financials')).toBe(false);
    expect(canSee('field_technician', 'approvals')).toBe(false);
    expect(can('field_technician', 'view_financials')).toBe(false);
  });

  it('holds no approval capability of any kind', () => {
    expect(can('field_technician', 'approve_financial')).toBe(false);
    expect(can('field_technician', 'approve_schedule')).toBe(false);
    expect(can('field_technician', 'approve_scope')).toBe(false);
  });

  it('can still edit the jobs it works on', () => {
    expect(can('field_technician', 'edit_job')).toBe(true);
  });
});

describe('capability boundaries', () => {
  it('restricts integration management to office managers', () => {
    const allowed = ALL_ROLES.filter((r) => can(r, 'manage_integrations'));
    expect(allowed).toEqual(['office_manager']);
  });

  it('keeps workflow authoring away from sales and field roles', () => {
    expect(can('sales', 'manage_workflows')).toBe(false);
    expect(can('field_technician', 'manage_workflows')).toBe(false);
  });

  it('lets accountants approve money but not scope', () => {
    expect(can('accountant', 'approve_financial')).toBe(true);
    expect(can('accountant', 'approve_scope')).toBe(false);
  });

  it('lets project managers approve scope but not money', () => {
    expect(can('project_manager', 'approve_scope')).toBe(true);
    expect(can('project_manager', 'approve_financial')).toBe(false);
  });
});

describe('executive', () => {
  it('is identified for roll-up views', () => {
    expect(isExecutive('executive')).toBe(true);
    expect(isExecutive('office_manager')).toBe(false);
  });

  it('sees the business but is not handed task-level work', () => {
    expect(canSee('executive', 'financials')).toBe(true);
    expect(canSee('executive', 'my-work')).toBe(false);
  });
});
