/**
 * Versioned Terms of Service acknowledgment.
 *
 * CURRENT_TERMS_VERSION is the date string on website/terms.html
 * ("Last Modified: 9/10/2026"). Bump it when that page is revised so
 * everyone who accepted an older version must acknowledge again.
 */

export const CURRENT_TERMS_VERSION = '2026-09-10';
export const TERMS_PUBLIC_URL = 'https://atmosphereteam.com/terms';
export const PRIVACY_PUBLIC_URL = 'https://atmosphereteam.com/privacy';

export const TERMS_REQUIRED_CODE = 'terms_required';
export const TERMS_REQUIRED_MESSAGE =
  'Acknowledge the Terms of Service to continue.';

export type TermsStatus = {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  url: string;
};

export function termsStatus(accepted: {
  termsVersion: string | null;
  acceptedAt: string | null;
} | null): TermsStatus {
  const acceptedVersion = accepted?.termsVersion ?? null;
  const current = CURRENT_TERMS_VERSION;
  return {
    required: acceptedVersion !== current,
    currentVersion: current,
    acceptedVersion,
    acceptedAt: accepted?.acceptedAt ?? null,
    url: TERMS_PUBLIC_URL,
  };
}

/** True when the recorded version matches the live terms revision. */
export function hasAcceptedCurrentTerms(
  acceptedVersion: string | null | undefined,
  currentVersion: string = CURRENT_TERMS_VERSION,
): boolean {
  return Boolean(acceptedVersion && acceptedVersion === currentVersion);
}

/** Signup / register / join must send the live version, not an older one. */
export function isAcceptableTermsVersion(
  version: string | null | undefined,
  currentVersion: string = CURRENT_TERMS_VERSION,
): boolean {
  return typeof version === 'string' && version.trim() === currentVersion;
}

const TERMS_EXEMPT_PREFIXES = [
  '/api/auth',
  '/api/legal',
  '/api/analytics',
  '/api/cyber',
  '/api/telemetry',
  '/api/health',
  '/api/ready',
  '/health',
  '/ready',
];

/**
 * Authenticated routes that must still work before the user accepts —
 * session restore, recording acceptance, sign-out, and staff tools.
 */
export function isTermsExemptPath(path: string): boolean {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || path;
  if (clean === '/' || clean === '/api') return true;
  if (clean === '/api/org/me' || clean.startsWith('/api/org/me/')) return true;
  if (clean === '/api/profile' || clean.startsWith('/api/profile/')) return true;
  return TERMS_EXEMPT_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`),
  );
}

export function clientIp(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim().slice(0, 128) || null;
  }
  if (Array.isArray(forwarded) && typeof forwarded[0] === 'string') {
    return forwarded[0].split(',')[0]?.trim().slice(0, 128) || null;
  }
  const ip = typeof req.ip === 'string' ? req.ip.trim() : '';
  return ip ? ip.slice(0, 128) : null;
}

export function clientUserAgent(req: { get?: (name: string) => string | undefined }): string | null {
  const ua = req.get?.('user-agent')?.trim() ?? '';
  return ua ? ua.slice(0, 512) : null;
}
