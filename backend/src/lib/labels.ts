import type { MEMBER_ROLES, WORK_TYPES } from './validation.js';

/**
 * Human-readable names for the membership enums. The frontend has its own copy
 * for UI copy; this one exists so the assistant can describe a technician to
 * the model in plain English rather than shipping `field_technician` into a
 * prompt.
 */

type MemberRole = (typeof MEMBER_ROLES)[number];
type WorkType = (typeof WORK_TYPES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  global_admin: 'global admin',
  employee: 'employee',
  project_manager: 'employee',
  field_technician: 'employee',
  accountant: 'employee',
  office_manager: 'global admin',
  sales: 'employee',
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  mitigation: 'mitigation',
  construction: 'construction',
};
