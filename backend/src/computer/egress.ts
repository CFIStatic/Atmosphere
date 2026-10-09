/**
 * Where an org's Computer traffic leaves the internet from.
 *
 * Atmosphere represents where the customer's team actually is, not the data
 * center the agent happens to run in. This applies to every login Computer
 * uses — the cloud browser and the Windows desktop alike:
 *
 * - **Cloud browser (Browserbase).** Each org's sessions can egress through a
 *   proxy that exits at that org's location: either an external proxy on the
 *   customer's own network (their real office IP), or Browserbase's pool
 *   pinned to the org's city/region. Set per org in COMPUTER_EGRESS.
 * - **Windows desktop.** Egress is the host's own network already: an office
 *   PC exits at the office; a cloud VM is routed out through a connector on
 *   the customer's network (an OS/VPN setup, see docs/computer-desktop.md).
 *
 * This is for honest location, not for hiding automation. Off by default:
 * with COMPUTER_EGRESS unset, sessions use the provider's default egress.
 *
 *   COMPUTER_EGRESS  JSON map of org id → one of:
 *     { "proxyUrl": "http://user:pass@office.example.com:3128" }   // the office's own egress
 *     { "geolocation": { "city": "Dallas", "state": "TX", "country": "US" } }  // provider pool, pinned
 */
import { cleanEnvSecret } from './config.js';

export interface ExternalProxyEgress {
  kind: 'external';
  server: string;
  username: string | null;
  password: string | null;
}

export interface GeolocationEgress {
  kind: 'geolocation';
  city: string | null;
  state: string | null;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
}

export type OrgEgress = ExternalProxyEgress | GeolocationEgress;

function parseExternal(raw: string): ExternalProxyEgress | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'socks5:') return null;
  const username = u.username ? decodeURIComponent(u.username) : null;
  const password = u.password ? decodeURIComponent(u.password) : null;
  // The server the provider dials carries no credentials in the URL.
  const server = `${u.protocol}//${u.host}`;
  return { kind: 'external', server, username, password };
}

function parseEgress(raw: unknown): OrgEgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.proxyUrl === 'string' && r.proxyUrl.trim()) return parseExternal(r.proxyUrl.trim());
  const g = r.geolocation as Record<string, unknown> | undefined;
  if (g && typeof g.country === 'string' && /^[A-Za-z]{2}$/.test(g.country)) {
    return {
      kind: 'geolocation',
      city: typeof g.city === 'string' && g.city.trim() ? g.city.trim() : null,
      state: typeof g.state === 'string' && g.state.trim() ? g.state.trim() : null,
      country: g.country.toUpperCase(),
    };
  }
  return null;
}

/** All configured egress, by org id. Bad entries are skipped. */
export function egressConfig(): Map<string, OrgEgress> {
  const out = new Map<string, OrgEgress>();
  const raw = cleanEnvSecret('COMPUTER_EGRESS', process.env.COMPUTER_EGRESS);
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [orgId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const egress = parseEgress(value);
    if (egress) out.set(orgId, egress);
  }
  return out;
}

export function orgEgress(orgId: string): OrgEgress | null {
  return egressConfig().get(orgId) ?? null;
}

/** One entry in Browserbase's session `proxies` array, or null for the default egress. */
export function browserbaseProxy(egress: OrgEgress | null): Record<string, unknown> | null {
  if (!egress) return null;
  if (egress.kind === 'external') {
    return {
      type: 'external',
      server: egress.server,
      ...(egress.username ? { username: egress.username } : {}),
      ...(egress.password ? { password: egress.password } : {}),
    };
  }
  const geolocation: Record<string, string> = { country: egress.country };
  if (egress.city) geolocation.city = egress.city;
  if (egress.state) geolocation.state = egress.state;
  return { type: 'browserbase', geolocation };
}
