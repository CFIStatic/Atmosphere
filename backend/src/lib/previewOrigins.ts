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
 * Atmosphere-internal is the staff data platform (accounts + analytics). Same
 * same-origin /api proxy, same cookie Origin problem.
 */

const QUICK_TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i;
const ATMOSPHERE_RAILWAY_WEB =
  /^https:\/\/atmosphere-web(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const ATMOSPHERE_RAILWAY_INTERNAL =
  /^https:\/\/atmosphere-internal(?:-[a-z0-9]+)*\.up\.railway\.app$/i;

export function isCloudflareQuickTunnelOrigin(origin: string): boolean {
  return QUICK_TUNNEL.test(origin);
}

export function isAtmosphereRailwayWebOrigin(origin: string): boolean {
  return ATMOSPHERE_RAILWAY_WEB.test(origin);
}

export function isAtmosphereRailwayInternalOrigin(origin: string): boolean {
  return ATMOSPHERE_RAILWAY_INTERNAL.test(origin);
}
