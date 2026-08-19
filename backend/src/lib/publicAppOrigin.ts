import { config } from '../config.js';
import { isAtmosphereRailwayWebOrigin } from './previewOrigins.js';

/**
 * Live office console until app.atmosphereteam.com has public DNS.
 * Invite emails must open this host — CORS already allows it.
 */
export const LIVE_OFFICE_ORIGIN = 'https://atmosphere-web-production.up.railway.app';

const UNMAPPED_INTENDED_APP = /^https:\/\/(app|api)\.atmosphereteam\.com\/?$/i;

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
