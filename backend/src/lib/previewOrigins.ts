/**
 * Origins that may sign in during local / cloud-agent previews.
 *
 * Cloudflare quick tunnels are HTTPS hosts that change every time a phone
 * tunnel starts. Production still uses the explicit FRONTEND_ORIGIN list.
 */

const QUICK_TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i;

export function isCloudflareQuickTunnelOrigin(origin: string): boolean {
  return QUICK_TUNNEL.test(origin);
}
