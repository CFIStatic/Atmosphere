/**
 * Work Verification product roles.
 *
 * 1. global_admin — person paying the bill; full org access including billing
 * 2. employee     — general crew; same as admin except billing
 * 3. invited_worker — job-scoped only (job-share / party invite); not an org seat
 *
 * Legacy `member_role` values still arrive from older rows — normalize with
 * `toOrgProductRole` before gating UI.
 */

export const ORG_PRODUCT_ROLES = ['global_admin', 'employee'] as const;
export type OrgProductRole = (typeof ORG_PRODUCT_ROLES)[number];

export type ProductAccessRole = OrgProductRole | 'invited_worker';

export const PRODUCT_ROLE_LABELS: Record<ProductAccessRole, string> = {
  global_admin: 'Global Admin',
  employee: 'Employee',
  invited_worker: 'Invited worker',
};

export const PRODUCT_ROLE_BLURBS: Record<ProductAccessRole, string> = {
  global_admin: 'Pays the bill. Sees everything in the workspace, including billing.',
  employee:
    'Records jobs and works the full office console — everything except billing.',
  invited_worker:
    'Invited to one job (for example a subcontractor). Only that job’s brief, capture, and details.',
};

const LEGACY_TO_PRODUCT: Record<string, OrgProductRole> = {
  global_admin: 'global_admin',
  office_manager: 'global_admin',
  employee: 'employee',
  project_manager: 'employee',
  field_technician: 'employee',
  accountant: 'employee',
  sales: 'employee',
  executive: 'global_admin',
};

export function toOrgProductRole(role: string | null | undefined): OrgProductRole {
  return LEGACY_TO_PRODUCT[role ?? ''] ?? 'employee';
}

export function isGlobalAdmin(role: string | null | undefined): boolean {
  return toOrgProductRole(role) === 'global_admin';
}

export function canManageBilling(role: string | null | undefined): boolean {
  return isGlobalAdmin(role);
}

export function labelForMemberRole(role: string | null | undefined): string {
  return PRODUCT_ROLE_LABELS[toOrgProductRole(role)];
}
