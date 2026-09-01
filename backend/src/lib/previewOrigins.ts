/**
 * Origins that may sign in without being listed in FRONTEND_ORIGIN.
 *
 * Cloudflare quick tunnels are HTTPS hosts that change every time a phone
 * tunnel starts — development only.
 *
 * Atmosphere-web on Railway publishes as atmosphere-web.up.railway.app and
 * atmosphere-web-<environment>.up.railway.app. The office console proxies
 * /api same-origin, but browsers still send that Origin and production CORS
 * must accept it or signup/login become a 500.
 *
 * The live custom office host is platform.atmosphereteam.com (Cloudflare in
 * front of Atmosphere-web). Browsers send that Origin on every /api call —
 * login included — whether nginx proxies same-origin or the SPA talks to
 * the Railway API directly. FRONTEND_ORIGIN should list it too; this match
 * keeps sign-in working if the env var is stale after a domain change.
 *
 * Atmosphere-internal is the staff data platform (accounts + analytics). Same
 * same-origin /api proxy, same cookie Origin problem.
 *
 * Field Capture on Railway publishes as field-capture.up.railway.app and
 * field-capture-<environment>.up.railway.app. The live custom host is
 * app.atmosphereteam.com. Crews open that host, sign in, and the page
 * calls /api plus iframes the office Platform tab. CORS must accept that
 * Origin or the connect screen shows a generic "Request failed."
 */

const QUICK_TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i;
const ATMOSPHERE_RAILWAY_WEB =
  /^https:\/\/atmosphere-web(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const ATMOSPHERE_RAILWAY_INTERNAL =
  /^https:\/\/atmosphere-internal(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const ATMOSPHERE_RAILWAY_INTERNAL_GROWTH =
  /^https:\/\/melodious-inspiration(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const ATMOSPHERE_RAILWAY_FIELD_CAPTURE =
  /^https:\/\/field-capture(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const ATMOSPHERE_CUSTOM_APP = /^https:\/\/(?:www\.)?platform\.atmosphereteam\.com$/i;
const ATMOSPHERE_CUSTOM_FIELD_CAPTURE = /^https:\/\/(?:www\.)?app\.atmosphereteam\.com$/i;

/** Live office console on the custom domain (Cloudflare → Atmosphere-web). */
export const LIVE_CUSTOM_APP_ORIGIN = 'https://platform.atmosphereteam.com';

/** Live Field Capture host (Cloudflare → Field Capture service). */
export const LIVE_CUSTOM_FIELD_CAPTURE_ORIGIN = 'https://app.atmosphereteam.com';

export function isCloudflareQuickTunnelOrigin(origin: string): boolean {
  return QUICK_TUNNEL.test(origin);
}

export function isAtmosphereRailwayWebOrigin(origin: string): boolean {
  return ATMOSPHERE_RAILWAY_WEB.test(origin);
}

export function isAtmosphereRailwayInternalOrigin(origin: string): boolean {
  return ATMOSPHERE_RAILWAY_INTERNAL.test(origin) || ATMOSPHERE_RAILWAY_INTERNAL_GROWTH.test(origin);
}

export function isAtmosphereRailwayFieldCaptureOrigin(origin: string): boolean {
  return ATMOSPHERE_RAILWAY_FIELD_CAPTURE.test(origin);
}

export function isAtmosphereCustomAppOrigin(origin: string): boolean {
  return ATMOSPHERE_CUSTOM_APP.test(origin);
}

export function isAtmosphereCustomFieldCaptureOrigin(origin: string): boolean {
  return ATMOSPHERE_CUSTOM_FIELD_CAPTURE.test(origin);
}
