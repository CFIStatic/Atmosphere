import type { Role } from './types';

/**
 * Role-based capability table.
 *
 * One declarative map rather than scattered `role === 'x'` checks, so answering
 * "what can a field tech actually do?" means reading one object. Navigation
 * visibility, default landing route, and action gating all derive from here.
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
  | 'integrations'
  | 'settings';

export type Capability =
  | 'approve_financial'
  | 'approve_schedule'
  | 'approve_scope'
  | 'edit_job'
  | 'view_all_jobs'
  | 'view_financials'
  | 'manage_workflows'
  | 'manage_integrations'
  | 'manage_team';

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
  'integrations',
  'settings',
];

export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  // Works a list of assigned tasks on a phone. Deliberately not shown company
  // financials or the approvals queue — noise they cannot act on.
  field_technician: {
    home: '/my-work',
    nav: ['my-work', 'jobs', 'schedule', 'settings'],
    capabilities: ['edit_job'],
    fieldFirst: true,
  },
  sales: {
    home: '/customers',
    nav: ['overview', 'my-work', 'customers', 'estimates', 'jobs', 'schedule', 'settings'],
    capabilities: ['view_all_jobs', 'edit_job'],
    fieldFirst: false,
  },
  accountant: {
    home: '/financials',
    nav: ['overview', 'approvals', 'financials', 'estimates', 'customers', 'jobs', 'settings'],
    capabilities: ['approve_financial', 'view_all_jobs', 'view_financials'],
    fieldFirst: false,
  },
  project_manager: {
    home: '/overview',
    nav: EVERYTHING.filter((k) => k !== 'integrations'),
    capabilities: [
      'approve_schedule',
      'approve_scope',
      'edit_job',
      'view_all_jobs',
      'view_financials',
    ],
    fieldFirst: false,
  },
  office_manager: {
    home: '/overview',
    nav: EVERYTHING,
    capabilities: [
      'approve_financial',
      'approve_schedule',
      'approve_scope',
      'edit_job',
      'view_all_jobs',
      'view_financials',
      'manage_workflows',
      'manage_integrations',
      'manage_team',
    ],
    fieldFirst: false,
  },
  // Roll-up consumer: sees everything, works none of it.
  executive: {
    home: '/overview',
    nav: ['overview', 'approvals', 'jobs', 'financials', 'customers', 'agents', 'settings'],
    capabilities: [
      'approve_financial',
      'approve_schedule',
      'approve_scope',
      'view_all_jobs',
      'view_financials',
      'manage_team',
    ],
    fieldFirst: false,
  },
};

export function profileFor(role: Role): RoleProfile {
  return ROLE_PROFILES[role];
}

export function can(role: Role, capability: Capability): boolean {
  return ROLE_PROFILES[role].capabilities.includes(capability);
}

export function canSee(role: Role, nav: NavKey): boolean {
  return ROLE_PROFILES[role].nav.includes(nav);
}

export function homeFor(role: Role): string {
  return ROLE_PROFILES[role].home;
}

export function isFieldFirst(role: Role): boolean {
  return ROLE_PROFILES[role].fieldFirst;
}

/**
 * Executives see aggregate numbers rather than work queues. Kept as a named
 * predicate because `executive` is not yet a database role — when the migration
 * lands, this is the only place that needs revisiting.
 */
export function isExecutive(role: Role): boolean {
  return role === 'executive';
}
