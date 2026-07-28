/** Shared rules for how a person is named and abbreviated across the UI. */

/**
 * The best name we have for someone: their chosen display name, else the local
 * part of their email, else a neutral placeholder. Never shows a raw user id —
 * "9f3c…" tells a teammate nothing.
 */
export function displayName(fullName?: string | null, email?: string | null): string {
  const trimmed = fullName?.trim();
  if (trimmed) return trimmed;
  const local = email?.split('@')[0]?.trim();
  if (local) return local;
  return 'Teammate';
}

/** Up to two letters for an avatar bubble, derived from the same name. */
export function initials(fullName?: string | null, email?: string | null): string {
  const name = displayName(fullName, email);
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
