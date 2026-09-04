import { isGlobalAdmin } from '../lib/productRoles.js';

/**
 * Who may unlink a login from the office account.
 *
 * Pure on purpose: the Settings "Remove" button and the DELETE route must
 * refuse the same three cases, and those refusals are easy to get wrong in
 * ways a type checker cannot see (removing yourself, removing the last
 * Global Admin, or letting an Employee do it).
 */

export type MemberRemovalDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403 | 409; code: string; message: string };

export function decideMemberRemoval(input: {
  callerUserId: string;
  callerRole: string;
  targetUserId: string;
  targetRole: string | null | undefined;
  adminCountInOrg: number;
}): MemberRemovalDecision {
  if (!isGlobalAdmin(input.callerRole)) {
    return {
      allowed: false,
      status: 403,
      code: 'insufficient_role',
      message: 'Only a Global Admin can remove people from this workspace.',
    };
  }
  if (input.callerUserId === input.targetUserId) {
    return {
      allowed: false,
      status: 400,
      code: 'cannot_remove_self',
      message: 'You cannot remove your own login here.',
    };
  }
  if (isGlobalAdmin(input.targetRole) && input.adminCountInOrg <= 1) {
    return {
      allowed: false,
      status: 409,
      code: 'last_admin',
      message: 'That person is the last Global Admin on this workspace.',
    };
  }
  return { allowed: true };
}
