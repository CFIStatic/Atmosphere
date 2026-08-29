import { displayName, initials, nameFromMetadata } from './display';

export interface VerifierSessionUser {
  name: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
  orgName: string | null;
  roleLabel: string | null;
  role: string | null;
}

/** Session payload posted into the Verifier iframe so the rail matches Settings. */
export function verifierSessionUser(input: {
  email?: string | null;
  fullName?: string | null;
  metadata?: Record<string, unknown> | null;
  avatarUrl?: string | null;
  orgName?: string | null;
  roleLabel?: string | null;
  role?: string | null;
}): VerifierSessionUser {
  const fullName = input.fullName || nameFromMetadata(input.metadata);
  const email = input.email ?? '';
  const avatarUrl =
    input.avatarUrl === undefined
      ? undefined
      : typeof input.avatarUrl === 'string' &&
          /^(https?:|data:image\/)/.test(input.avatarUrl.trim())
        ? input.avatarUrl.trim()
        : null;
  return {
    name: displayName(fullName, email),
    email,
    initials: initials(fullName, email),
    avatarUrl,
    orgName: input.orgName ?? null,
    roleLabel: input.roleLabel ?? null,
    role: input.role ?? null,
  };
}
