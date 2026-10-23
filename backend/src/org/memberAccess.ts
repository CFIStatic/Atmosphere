import type { AssignablePermissionRole, PermissionRole } from '../lib/productRoles.js';
import { isAdminPermission } from '../lib/productRoles.js';

/**
 * Who may change a teammate's permission role. Pure, so the Settings role
 * picker and PATCH /api/org/members/:id refuse the same cases:
 *  - only the owner and admins change roles;
 *  - nobody changes the owner, and nobody is made owner;
 *  - nobody changes their own role.
 */
export type MemberRoleDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403 | 409; code: string; message: string };

export function decideMemberRoleChange(input: {
  callerUserId: string;
  callerPermissionRole: PermissionRole;
  targetUserId: string;
  targetIsOwner: boolean;
  permissionRole: AssignablePermissionRole | 'owner';
}): MemberRoleDecision {
  if (!isAdminPermission(input.callerPermissionRole)) {
    return { allowed: false, status: 403, code: 'insufficient_role', message: 'Only the owner or an admin can change roles.' };
  }
  if (input.targetIsOwner) {
    return { allowed: false, status: 409, code: 'owner_locked', message: 'The account owner always keeps every permission.' };
  }
  if (input.permissionRole === 'owner') {
    return { allowed: false, status: 400, code: 'owner_role_reserved', message: 'There is one owner: the person who created the workspace.' };
  }
  if (input.callerUserId === input.targetUserId) {
    return { allowed: false, status: 400, code: 'cannot_change_self', message: 'You cannot change your own role.' };
  }
  return { allowed: true };
}
