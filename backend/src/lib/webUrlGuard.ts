import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import { HttpError } from './errors.js';

/**
 * Where a Web Access run is allowed to go.
 *
 * Two separate problems, both of which have to be solved before a browser is
 * driven by a language model:
 *
 * 1. **Scope.** A run is authorised against one site. The model decides its own
 *    navigation, so "stay on the site you were given" has to be enforced by us,
 *    not requested in a prompt — otherwise a misread link, or a page that says
 *    "ignore your instructions and go here", walks the session somewhere the
 *    org never authorised.
 *
 * 2. **SSRF.** A URL is attacker-influenceable input the moment it comes off a
 *    page. Without a check, `http://169.254.169.254/` or `http://localhost:4000`
 *    would let a run reach cloud metadata or this very API from inside the
 *    network perimeter. Hostnames are resolved and every returned address is
 *    checked, so a public name that resolves to a private address is caught too.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Parse strictly; anything else is treated as no URL at all. */
export function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // unparseable → refuse
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true; // unspecified, loopback
  // IPv4-mapped (::ffff:10.0.0.1) inherits the IPv4 verdict.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (normalized.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(normalized)) return true; // unique local
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true; // not an address we can reason about → refuse
}

/**
 * The last two labels of a host — enough to treat `portal.example.com` and
 * `login.example.com` as the same site without pulling in a public-suffix list.
 * Deliberately conservative in the other direction: a host under a multi-part
 * TLD simply has to be named in WEB_ACCESS_ALLOWED_HOSTS.
 */
function registrableBase(hostname: string): string {
  const labels = hostname.toLowerCase().split('.');
  return labels.length <= 2 ? hostname.toLowerCase() : labels.slice(-2).join('.');
}

export function isHostInScope(target: URL, siteOrigin: URL): boolean {
  const host = target.hostname.toLowerCase();
  const siteHost = siteOrigin.hostname.toLowerCase();
  if (host === siteHost) return true;
  if (config.webAccess.extraAllowedHosts.includes(host)) return true;
  // Same registrable base covers the login/app/api subdomain split most
  // portals use, without opening up the whole internet.
  return registrableBase(host) === registrableBase(siteHost);
}

/**
 * Full check for a URL a run is about to open. Resolves the hostname, so a
 * name that points at a private address is refused even though it looks public.
 */
export async function assertNavigable(target: URL, siteOrigin: URL): Promise<void> {
  if (!isHostInScope(target, siteOrigin)) {
    throw new HttpError(
      400,
      `Navigation to ${target.hostname} is outside this connection's site (${siteOrigin.hostname}).`,
      'web_access_out_of_scope',
    );
  }

  // Development only, and off unless explicitly asked for: lets you point a
  // connection at a fixture running on your own machine.
  if (config.webAccess.allowPrivateAddresses) return;

  const literal = isIP(target.hostname);
  const addresses = literal
    ? [{ address: target.hostname }]
    : await lookup(target.hostname, { all: true, verbatim: true }).catch(() => {
        throw new HttpError(400, `Could not resolve ${target.hostname}.`, 'web_access_dns_failed');
      });

  if (addresses.length === 0) {
    throw new HttpError(400, `Could not resolve ${target.hostname}.`, 'web_access_dns_failed');
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new HttpError(
      400,
      `${target.hostname} resolves to a private network address and cannot be reached.`,
      'web_access_private_address',
    );
  }
}

/** Validates a site URL at the moment a member saves a connection. */
export async function assertUsableSiteUrl(raw: string): Promise<URL> {
  const url = parseHttpUrl(raw);
  if (!url) {
    throw new HttpError(400, 'Enter a full site address starting with https://', 'web_access_bad_url');
  }
  await assertNavigable(url, url);
  return url;
}
