/**
 * Internal staff site identity helpers. Access is invite-only (env allowlist
 * or Access-page approval). Sign-in uses the same Platform email + password
 * (Supabase Auth) — not a parallel password store or Authenticator TOTP.
 */

export const STAFF_LOGIN_DENIED = 'That sign-in is not valid.';

export const STAFF_NOT_INVITED =
  'This email is not invited to Atmosphere Internal. Ask an admin to invite you, or request access.';

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
