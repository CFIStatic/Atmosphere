import type { Role } from './types';
import { toOrgProductRole, type OrgProductRole } from './productRoles';

/**
 * Role-based capability table.
 *
 * Work Verification seats:
 *   - global_admin — full console including billing
 *   - employee     — same console without billing
 *
 * Invited workers are not org members; they use job-share tokens and never
 * hit this table. Legacy Role values still appear in fixtures — they normalize
 * through `toOrgProductRole` before a lookup.
 */

export type NavKey =
  | 'overview'
  | 'my-work'
  | 'approvals'
  | 'jobs'
  | 'schedule'
  | 'estimates'
  | 'customers'
  | 'financials'
  | 'agents'
  | 'workflows'
  | 'connections'
  | 'settings';

export type Capability =
  | 'approve_financial'
  | 'approve_schedule'
  | 'approve_scope'
  | 'edit_job'
  | 'view_all_jobs'
  | 'view_financials'
  | 'manage_workflows'
  | 'manage_connections'
  | 'manage_team'
  | 'manage_billing';

interface RoleProfile {
  /** Where this role lands after sign-in. */
  home: `/${NavKey}`;
  /** Nav items visible, in the order the role cares about them. */
  nav: NavKey[];
  capabilities: Capability[];
  /** Field-first roles get the mobile workflow by default. */
  fieldFirst: boolean;
}

const EVERYTHING: NavKey[] = [
  'overview',
  'my-work',
  'approvals',
  'jobs',
  'schedule',
  'estimates',
  'customers',
  'financials',
  'agents',
  'workflows',
  'connections',
  'settings',
];

const EMPLOYEE_CAPABILITIES: Capability[] = [
  'approve_financial',
  'approve_schedule',
  'approve_scope',
  'edit_job',
  'view_all_jobs',
  'view_financials',
  'manage_workflows',
  'manage_connections',
  'manage_team',
];

export const PRODUCT_ROLE_PROFILES: Record<OrgProductRole, RoleProfile> = {
  global_admin: {
    home: '/overview',
    nav: EVERYTHING,
    capabilities: [...EMPLOYEE_CAPABILITIES, 'manage_billing'],
    fieldFirst: false,
  },
  employee: {
    home: '/overview',
    nav: EVERYTHING,
    capabilities: EMPLOYEE_CAPABILITIES,
    fieldFirst: false,
  },
};

/** @deprecated Prefer PRODUCT_ROLE_PROFILES — kept so legacy Role keys still resolve. */
export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  global_admin: PRODUCT_ROLE_PROFILES.global_admin,
  employee: PRODUCT_ROLE_PROFILES.employee,
  office_manager: PRODUCT_ROLE_PROFILES.global_admin,
  executive: PRODUCT_ROLE_PROFILES.global_admin,
  project_manager: PRODUCT_ROLE_PROFILES.employee,
  field_technician: PRODUCT_ROLE_PROFILES.employee,
  accountant: PRODUCT_ROLE_PROFILES.employee,
  sales: PRODUCT_ROLE_PROFILES.employee,
};

export function profileFor(role: Role): RoleProfile {
  return PRODUCT_ROLE_PROFILES[toOrgProductRole(role)];
}

export function can(role: Role, capability: Capability): boolean {
  return profileFor(role).capabilities.includes(capability);
}

export function canSee(role: Role, nav: NavKey): boolean {
  return profileFor(role).nav.includes(nav);
}

export function homeFor(role: Role): string {
  return profileFor(role).home;
}

export function isFieldFirst(role: Role): boolean {
  return profileFor(role).fieldFirst;
}

/** Global Admin (bill payer) — including remapped legacy office_manager / executive. */
export function isExecutive(role: Role): boolean {
  return toOrgProductRole(role) === 'global_admin';
}
