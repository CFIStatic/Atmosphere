import { promises as dns } from 'node:dns';
import net from 'node:net';

/**
 * Outbound fetch for addresses a *user* chose.
 *
 * The crawler follows company domains that arrive in a search query, which
 * makes every request here server-side request forgery waiting to happen. A
 * customer who types `companyDomain: localhost` — or, far worse,
 * `169.254.169.254` — is asking our server to fetch something on its own
 * network and hand back the body. On a cloud host that address is the instance
 * metadata service, and the body is credentials.
 *
 * So every hostname is resolved before it is fetched and checked against the
 * private ranges, and the check is repeated on each redirect hop because a
 * public host is perfectly capable of redirecting to a private one.
 *
 * The other limits are politeness rather than security: a short timeout, a
 * response cap so a hostile server cannot stream us to death, and a user agent
 * that says who we are and how to make us stop.
 */

export const CRAWLER_USER_AGENT =
  'AtmosphereBot/1.0 (+https://atmosphere.build/bot; contact-discovery)';

/** Blocked ranges: loopback, private, link-local, CGNAT, and IPv6 equivalents. */
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    // IPv4-mapped: ::ffff:169.254.169.254 must not slip past the v4 rules.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

/** Every address a hostname resolves to must be public, not merely the first. */
async function hostIsPublic(hostname: string): Promise<boolean> {
  // A literal IP in the URL never reaches DNS, so check it directly.
  if (net.isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) return false;
    return records.every((r) => !isPrivateAddress(r.address));
  } catch {
    return false;
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  /** Response cap. A team page is small; anything huge is not one. */
  maxBytes?: number;
  maxRedirects?: number;
}

/**
 * Fetch a public URL, or return null. Never throws.
 *
 * Null covers everything: a private address, a refusal, a timeout, a body too
 * large. Callers treat all of them the same way — this source had nothing —
 * which is what keeps one unreachable site from failing a whole reveal.
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 6_000;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  let redirectsLeft = options.maxRedirects ?? 3;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (;;) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!(await hostIsPublic(url.hostname))) return null;

      let res: Response;
      try {
        res = await fetch(url, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': CRAWLER_USER_AGENT,
            Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          },
        });
      } catch {
        return null;
      }

      // Follow redirects by hand so each hop is re-checked against the private
      // ranges. `redirect: 'follow'` would do the hops inside fetch, where we
      // never see the intermediate hosts.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || redirectsLeft <= 0) return null;
        redirectsLeft -= 1;
        try {
          url = new URL(location, url);
        } catch {
          return null;
        }
        continue;
      }

      if (!res.ok) return null;

      const type = res.headers.get('content-type') ?? '';
      if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;

      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared && declared > maxBytes) return null;

      // Read with a cap rather than trusting content-length, which a hostile
      // server is free to lie about or omit.
      const reader = res.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    }
  } finally {
    clearTimeout(timer);
  }
}
