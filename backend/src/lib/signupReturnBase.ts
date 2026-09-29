import {
  LIVE_CUSTOM_APP_ORIGIN,
  isAtmosphereCustomFieldCaptureOrigin,
  isAtmosphereRailwayFieldCaptureOrigin,
} from './previewOrigins.js';

function stripSlash(value: string): string {
  return value.replace(/\/$/, '');
}

/** Field Capture hosts (app.atmosphereteam.com and field-capture-*.up.railway.app). */
export function isFieldCaptureReturnUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const origin = `${url.protocol}//${url.host}`;
    return (
      isAtmosphereCustomFieldCaptureOrigin(origin) ||
      isAtmosphereRailwayFieldCaptureOrigin(origin)
    );
  } catch {
    return /app\.atmosphereteam\.com|field-capture(?:-[a-z0-9]+)*\.up\.railway\.app/i.test(trimmed);
  }
}

/**
 * Where Stripe Checkout sends a signup back.
 *
 * The office session cookie lives on the Platform host. A cancel_url (or
 * success_url) on app.atmosphereteam.com opens Field Capture's login and
 * drops that session. Prefer an explicit non-Field-Capture return base,
 * then platform.atmosphereteam.com, then the local office dev server.
 */
export function officeSignupReturnBase(origins: string[], explicit?: string | null): string {
  const configured = explicit?.trim();
  if (configured && !isFieldCaptureReturnUrl(configured)) return stripSlash(configured);

  const cleaned = origins.map((origin) => origin.trim()).filter(Boolean);
  const platform = cleaned.find((origin) =>
    /^https:\/\/(?:www\.)?platform\.atmosphereteam\.com\/?$/i.test(origin),
  );
  if (platform) return `${stripSlash(platform)}/signup`;

  const loopback = cleaned.find((origin) =>
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(origin),
  );
  if (loopback) return `${stripSlash(loopback)}/signup`;

  const staging = cleaned.find(
    (origin) =>
      /^https:\/\/atmosphere-web(?:-[a-z0-9]+)+\.up\.railway\.app\/?$/i.test(origin) &&
      !/atmosphere-web-production\.up\.railway\.app/i.test(origin),
  );
  if (staging) return `${stripSlash(staging)}/signup`;

  return `${LIVE_CUSTOM_APP_ORIGIN}/signup`;
}
