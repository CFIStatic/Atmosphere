/** Allowed post-auth destinations — relative in-app paths only. */
export function safeAuthRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = raw.trim();
  if (!path.startsWith('/')) return null;
  if (path.startsWith('//')) return null;
  if (path.includes('://')) return null;
  // Drop anything that could break out of the SPA router.
  path = path.split(/[\r\n]/)[0] ?? path;
  return path || null;
}

/** Prefer an explicit ?next= link (survives refresh and cross-site CTAs). */
export function resolveAuthRedirect(
  nextParam: string | null,
  stateFrom: string | null | undefined,
  fallback: string,
): string {
  return safeAuthRedirect(nextParam) ?? safeAuthRedirect(stateFrom) ?? fallback;
}

/** Build /login?next=… for marketing-site and email deep links. */
export function loginHref(next: string): string {
  const safe = safeAuthRedirect(next);
  if (!safe) return '/login';
  return `/login?next=${encodeURIComponent(safe)}`;
}
