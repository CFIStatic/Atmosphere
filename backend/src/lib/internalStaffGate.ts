import { createHash, timingSafeEqual } from 'node:crypto';

export const STAFF_LOGIN_DENIED = 'That sign-in is not valid.';

export function accessCodesMatch(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(provided.normalize('NFKC')).digest();
  const b = createHash('sha256').update(expected.normalize('NFKC')).digest();
  return timingSafeEqual(a, b);
}

export function staffFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
}

export function evaluateInternalStaffGate(input: {
  firstName: string;
  lastName: string;
  email: string;
  accessCode: string;
  expectedAccessCode: string;
  allowlisted: boolean;
}): { ok: true; fullName: string } | { ok: false } {
  if (!input.allowlisted) return { ok: false };
  if (!accessCodesMatch(input.accessCode, input.expectedAccessCode)) return { ok: false };
  return { ok: true, fullName: staffFullName(input.firstName, input.lastName) };
}
