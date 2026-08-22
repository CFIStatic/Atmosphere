/**
 * Internal staff site identity (name + allowlisted email). The authenticator
 * code is checked separately as TOTP.
 */

export const STAFF_LOGIN_DENIED = 'That sign-in is not valid.';

export function staffFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
}
