import { toOrgProductRole } from '../lib/productRoles.js';

/** Synthetic inbox for Field Capture crew logins — never mailed. */
export const FIELD_CAPTURE_EMAIL_DOMAIN = 'field.atmosphere.app';

export function normalizeCrewName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function crewNameKey(name: string): string {
  return normalizeCrewName(name).toLowerCase();
}

export function isFieldCaptureEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(`@${FIELD_CAPTURE_EMAIL_DOMAIN}`));
}

/** Name+code crew login matches Employees (including remapped field techs). */
export function isCrewLoginMember(role: string | undefined, email: string | null | undefined): boolean {
  return toOrgProductRole(role) === 'employee' || isFieldCaptureEmail(email);
}

/**
 * Stable per-person address inside one office. The same name in the same
 * office maps back to the same Atmosphere user on a new phone.
 */
export function fieldCaptureEmail(orgId: string, name: string): string {
  const slug = crewNameKey(name)
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
  const org = orgId.replace(/-/g, '').slice(0, 12);
  return `${slug || 'crew'}.${org}@${FIELD_CAPTURE_EMAIL_DOMAIN}`;
}
