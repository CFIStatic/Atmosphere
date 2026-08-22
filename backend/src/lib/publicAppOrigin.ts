import { config } from '../config.js';
import { isAtmosphereRailwayWebOrigin } from './previewOrigins.js';

/**
 * Live office console until app.atmosphereteam.com has public DNS.
 * Invite emails must open this host — CORS already allows it.
 */
export const LIVE_OFFICE_ORIGIN = 'https://atmosphere-web-production.up.railway.app';

const UNMAPPED_INTENDED_APP = /^https:\/\/(app|api)\.atmosphereteam\.com\/?$/i;
const UNMAPPED_APP_HOST = /^(app|api)\.atmosphereteam\.com$/i;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1)$/i;

function stripSlash(origin: string): string {
  return origin.replace(/\/$/, '');
}

/**
 * Public URL stamped into invite / share emails.
 *
 * FRONTEND_ORIGIN still lists https://app.atmosphereteam.com as the intended
 * product host, but that name has no A/CNAME yet. Prefer the Railway office
 * that Jack is already using so "Open job on phone" is a real link.
 */
export function publicAppOrigin(origins: string[] = config.frontendOrigins): string {
  const cleaned = origins.map((o) => o.trim()).filter(Boolean);

  const railway = cleaned.find((o) => isAtmosphereRailwayWebOrigin(o));
  if (railway) return stripSlash(railway);

  const mappedHttps = cleaned.find(
    (o) =>
      /^https:\/\//i.test(o) &&
      !/localhost|127\.0\.0\.1/i.test(o) &&
      !UNMAPPED_INTENDED_APP.test(o),
  );
  if (mappedHttps) return stripSlash(mappedHttps);

  return LIVE_OFFICE_ORIGIN;
}

/**
 * A recovery URL that nobody can open: the unmapped custom domain, loopback in
 * production, or localhost:3000 (Supabase's default Site URL — this app's Vite
 * server is 5174, so that link is the "Safari can't connect to localhost"
 * failure).
 */
export function isUnusablePasswordResetUrl(
  url: string,
  isProduction: boolean = config.isProduction,
): boolean {
  try {
    const parsed = new URL(url);
    if (UNMAPPED_APP_HOST.test(parsed.hostname)) return true;
    if (!LOOPBACK_HOST.test(parsed.hostname)) return false;
    if (isProduction) return true;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return port === '3000' || port === '80' || port === '443';
  } catch {
    return true;
  }
}

/**
 * Where a password-reset email must send the user.
 *
 * Do not use FRONTEND_ORIGIN[0]: that is often the future custom domain or a
 * localhost origin, and GoTrue falls back to Site URL (localhost:3000) when
 * the redirect is not allowlisted. Stamp the live office host instead.
 */
export function passwordResetRedirectUrl(
  origins: string[] = config.frontendOrigins,
  explicit: string | undefined = config.passwordResetRedirectUrl || undefined,
  isProduction: boolean = config.isProduction,
): string {
  const trimmed = explicit?.trim();
  if (trimmed && !isUnusablePasswordResetUrl(trimmed, isProduction)) {
    return stripSlash(trimmed);
  }
  return `${publicAppOrigin(origins)}/reset-password`;
}

/** Recovery page URL carrying a server-side token_hash — never a session JWT. */
export function recoveryPageUrl(resetUrl: string, tokenHash: string): string {
  const url = new URL(resetUrl);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'recovery');
  return url.toString();
}
