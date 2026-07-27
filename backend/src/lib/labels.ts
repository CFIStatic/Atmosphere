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
  project_manager: 'project manager',
  field_technician: 'field technician',
  accountant: 'accountant',
  office_manager: 'office manager',
  sales: 'salesperson',
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  mitigation: 'mitigation',
  construction: 'construction',
};
