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

describe('product seats', () => {
  it('gives Global Admin billing and Employees everything else', () => {
    expect(can('global_admin', 'manage_billing')).toBe(true);
    expect(can('employee', 'manage_billing')).toBe(false);
    expect(can('employee', 'view_all_jobs')).toBe(true);
    expect(can('employee', 'edit_job')).toBe(true);
    expect(can('employee', 'manage_team')).toBe(true);
  });

  it('maps legacy office_manager to Global Admin capabilities', () => {
    expect(can('office_manager', 'manage_billing')).toBe(true);
    expect(isExecutive('office_manager')).toBe(true);
  });

  it('maps legacy crew roles to Employee capabilities', () => {
    expect(can('field_technician', 'manage_billing')).toBe(false);
    expect(can('project_manager', 'view_all_jobs')).toBe(true);
    expect(isFieldFirst('field_technician')).toBe(false);
  });
});

describe('capability boundaries', () => {
  it('restricts billing to Global Admin seats', () => {
    const allowed = ALL_ROLES.filter((r) => can(r, 'manage_billing'));
    expect(allowed.sort()).toEqual(['executive', 'global_admin', 'office_manager'].sort());
  });

  it('lets employees manage connections and workflows', () => {
    expect(can('employee', 'manage_connections')).toBe(true);
    expect(can('employee', 'manage_workflows')).toBe(true);
  });
});

describe('executive / global admin', () => {
  it('is identified for roll-up and billing views', () => {
    expect(isExecutive('executive')).toBe(true);
    expect(isExecutive('global_admin')).toBe(true);
    expect(isExecutive('employee')).toBe(false);
  });

  it('sees the full console including financials', () => {
    expect(canSee('global_admin', 'financials')).toBe(true);
    expect(canSee('employee', 'financials')).toBe(true);
    expect(homeFor('global_admin')).toBe('/overview');
  });
});
