import { hasFieldEmbedInPath, isFieldEmbedMarked, withFieldEmbed } from './fieldEmbed';

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
export function loginHref(next?: string): string {
  const safe = next ? safeAuthRedirect(next) : null;
  const embed = isFieldEmbedMarked() || (safe != null && hasFieldEmbedInPath(safe));
  const dest = safe && embed ? withFieldEmbed(safe) : safe;
  const params = new URLSearchParams();
  if (embed) params.set('embed', 'field');
  if (dest) params.set('next', dest);
  const qs = params.toString();
  return qs ? `/login?${qs}` : '/login';
}

export type SignupIntent = 'create' | 'join';

/** Create a new organization, or link this login to an existing office account. */
export function parseSignupIntent(raw: string | null | undefined): SignupIntent {
  return raw === 'join' ? 'join' : 'create';
}

/** Build /signup with optional email, return path, join code, and create vs. join intent. */
export function signupHref(options?: {
  next?: string;
  email?: string;
  intent?: SignupIntent;
  code?: string;
}): string {
  const params = new URLSearchParams();
  const next = options?.next ? safeAuthRedirect(options.next) : null;
  const email = options?.email?.trim();
  const code = options?.code?.trim().toUpperCase();
  if (next) params.set('next', next);
  if (email) params.set('email', email);
  if (options?.intent === 'join') params.set('intent', 'join');
  if (code) params.set('code', code);
  const qs = params.toString();
  return qs ? `/signup?${qs}` : '/signup';
}
