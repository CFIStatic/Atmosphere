/**
 * Work Verification product roles.
 *
 * 1. global_admin — person paying the bill; full org access including billing
 * 2. employee     — general crew; same as admin except billing
 * 3. invited_worker — job-scoped only (job-share / party invite); not org_members
 *
 * Legacy member_role enum values still exist in Postgres for history. Map them
 * through `toOrgProductRole` before any capability check.
 */

export const ORG_PRODUCT_ROLES = ['global_admin', 'employee'] as const;
export type OrgProductRole = (typeof ORG_PRODUCT_ROLES)[number];

/** Access kind that includes invited workers (job token), who are not org seats. */
export type ProductAccessRole = OrgProductRole | 'invited_worker';

export const PRODUCT_ROLE_LABELS: Record<ProductAccessRole, string> = {
  global_admin: 'Global Admin',
  employee: 'Employee',
  invited_worker: 'Invited worker',
};

/** Roles accepted on org_members / invites (product + legacy). */
export const MEMBER_ROLE_VALUES = [
  'global_admin',
  'employee',
  'project_manager',
  'field_technician',
  'accountant',
  'office_manager',
  'sales',
] as const;

export type MemberRoleValue = (typeof MEMBER_ROLE_VALUES)[number];

const LEGACY_TO_PRODUCT: Record<string, OrgProductRole> = {
  global_admin: 'global_admin',
  office_manager: 'global_admin',
  employee: 'employee',
  project_manager: 'employee',
  field_technician: 'employee',
  accountant: 'employee',
  sales: 'employee',
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
  const product = toOrgProductRole(role);
  return PRODUCT_ROLE_LABELS[product];
}

/**
 * Permission roles (20261023150000). Free to change and independent of the
 * paid products (seat_type / products):
 *   owner  — created the workspace; everything, including billing
 *   admin  — today's Global Admin powers (team, settings, playbooks…) but not billing
 *   member — normal work
 *   viewer — read only
 */
export const PERMISSION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];
/** What an invite or an admin may assign. Owner is never assigned. */
export const ASSIGNABLE_PERMISSION_ROLES = ['admin', 'member', 'viewer'] as const;
export type AssignablePermissionRole = (typeof ASSIGNABLE_PERMISSION_ROLES)[number];

export const PERMISSION_ROLE_LABELS: Record<PermissionRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export function parsePermissionRole(value: unknown): PermissionRole | null {
  return typeof value === 'string' && (PERMISSION_ROLES as readonly string[]).includes(value)
    ? (value as PermissionRole)
    : null;
}

/**
 * The permission role of a member row. Before the migration has run (no
 * permission_role column) the old meaning applies: a Global Admin is an admin.
 */
export function effectivePermissionRole(row: {
  permission_role?: unknown;
  role?: unknown;
  isOwner?: boolean;
}): PermissionRole {
  if (row.isOwner) return 'owner';
  const parsed = parsePermissionRole(row.permission_role);
  if (parsed) return parsed;
  return isGlobalAdmin(typeof row.role === 'string' ? row.role : null) ? 'admin' : 'member';
}

/** Owner and admin hold what used to be called Global Admin powers. */
export function isAdminPermission(role: PermissionRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The legacy product role a permission role maps to, for code that still asks "Global Admin?". */
export function productRoleForPermission(role: PermissionRole): OrgProductRole {
  return isAdminPermission(role) ? 'global_admin' : 'employee';
}
