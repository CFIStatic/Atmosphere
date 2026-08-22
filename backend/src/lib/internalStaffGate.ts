/**
 * Internal staff site identity (name + allowlisted email). After the first
 * Authenticator enrollment, the 6-digit code is the password.
 */

export const STAFF_LOGIN_DENIED = 'That sign-in is not valid.';

export function staffFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
}

export function hasStaffName(value: string | undefined | null): boolean {
  return Boolean(value?.trim());
}

export function fallbackStaffNames(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] ?? 'Staff';
  const first = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Staff';
  return { firstName: first, lastName: 'Staff' };
}

export function resolveStaffNames(
  provided: { firstName?: string; lastName?: string },
  stored?: { firstName?: string | null; lastName?: string | null } | null,
  email?: string,
): { firstName: string; lastName: string } {
  const firstName = provided.firstName?.trim() || stored?.firstName?.trim() || '';
  const lastName = provided.lastName?.trim() || stored?.lastName?.trim() || '';
  if (firstName && lastName) return { firstName, lastName };
  if (email) {
    const fallback = fallbackStaffNames(email);
    return {
      firstName: firstName || fallback.firstName,
      lastName: lastName || fallback.lastName,
    };
  }
  return { firstName: firstName || 'Staff', lastName: lastName || 'Member' };
}
