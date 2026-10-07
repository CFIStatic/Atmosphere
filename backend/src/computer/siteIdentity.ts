/**
 * Who is a custom website? Used by the Logins "+ Add" form so people only type
 * an address: Atmosphere names the site (and the UI shows its logo) itself.
 *
 * Order: 1. our built-in catalog (catalog name, sign-in page and logo),
 *        2. the site's own page (og:site_name / application-name / <title>),
 *        3. a prettified domain ("portal.acme.com" -> "Acme").
 *
 * The page fetch is SSRF-safe: https only, default port, every resolved
 * address must be public (checked inside the socket's DNS lookup so the
 * address that is checked is the one connected to), a short timeout, a
 * size cap, and at most a few re-checked redirects. Nothing from the page
 * other than a short cleaned-up name is kept.
 */
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { catalogSiteForHost, pickerSites } from './catalog/sites.js';
import { cleanUrl } from './service.js';

export interface SiteIdentity {
  /** The address as Atmosphere will open it (https://…). */
  url: string;
  /** Hostname, lowercase, without "www.". */
  host: string;
  name: string;
  /** Where the name came from. */
  source: 'catalog' | 'page' | 'domain';
  /** Catalog site id when the address is one of our built-in sites. */
  siteId: string | null;
  /** The catalog site's sign-in page, when it is one. */
  signInUrl: string | null;
}

/* ------------------------------------------------------------ addresses -- */

// Separate lists: one mixed BlockList can match public IPv6 against IPv4 rules.
const blocked4 = new net.BlockList();
const blocked6 = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked4.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked6.addSubnet(net6, prefix, 'ipv6');

/** True for an address on the public internet (not private, loopback, link-local, reserved…). */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !blocked4.check(ip, 'ipv4');
  if (family === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked6.check(ip, 'ipv6');
  }
  return false;
}

/** A hostname we may look up at all (before DNS). */
function hostAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h.length > 253) return false;
  if (net.isIP(h)) return isPublicAddress(h);
  if (!h.includes('.')) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/.test(h)) return false;
  return /^[a-z0-9.-]+$/.test(h);
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup that refuses non-public answers (used as the socket's lookup, so no rebinding gap). */
export function publicOnlyLookup(hostname: string, options: dns.LookupOptions | number, cb: LookupCb): void {
  const opts: dns.LookupOptions = typeof options === 'number' ? { family: options } : { ...options };
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err, '');
    const list = (addresses as dns.LookupAddress[]) ?? [];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      const e: NodeJS.ErrnoException = new Error('That address is not on the public internet.');
      e.code = 'EPRIVATE';
      return cb(e, '');
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0]!.address, list[0]!.family);
  });
}

/* ---------------------------------------------------------------- names -- */

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

const GENERIC = /^(sign[\s-]?in|sign[\s-]?on|log[\s-]?in|log[\s-]?on|login|logon|sso|single sign[\s-]?on|home|home ?page|welcome|dashboard|index|default|untitled|main|portal|account|my account|secure login|loading\.*|redirecting\.*|please wait\.*|just a moment\.*|attention required!?|access denied|forbidden|not found|page not found|error|\d{3}( error)?|object moved|document)$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|ndash|mdash|middot|raquo|laquo|trade|reg|copy);/gi, (m, n: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", ndash: '–', mdash: '—', middot: '·', raquo: '»', laquo: '«', trade: '', reg: '', copy: '' } as Record<string, string>)[n.toLowerCase()] ?? m);
}
function safeChar(code: number): string {
  return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
}

function tidy(s: string): string {
  return decodeEntities(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff<>]/g, ' ')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainWord(host: string): string {
  return prettyDomain(host).toLowerCase().replace(/\s+/g, '');
}

/** The best short site name in a candidate string, or null when it's generic. */
function cleanName(raw: string, host: string): string | null {
  let s = tidy(raw).replace(/^welcome to\s+/i, '');
  if (!s) return null;
  const parts = s.split(/\s+(?:::|[|\-–—·:»«/])\s+|\s*[|·»«]\s*/).map((p) => p.trim()).filter(Boolean);
  const useful = parts.filter((p) => !GENERIC.test(p) && !/^(sign|log) ?(in|on) (to|with)\b/i.test(p));
  if (!useful.length) return null;
  const word = domainWord(host);
  s =
    useful.find((p) => word && p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(word)) ??
    (parts.length > 1 ? useful[useful.length - 1]! : useful[0]!);
  s = s.replace(/^(sign|log) ?(in|on) (to|with)\s+/i, '').trim();
  if (!s || s.length > 60 || GENERIC.test(s)) return null;
  return s;
}

function metaContent(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))?.slice(1).find((v) => v !== undefined) ?? null;
    const key = (attr('property') ?? attr('name') ?? '').toLowerCase();
    if (keys.includes(key)) {
      const content = attr('content');
      if (content && content.trim()) return content;
    }
  }
  return null;
}

/** The site's own name from its HTML head, cleaned up; null when nothing useful. */
export function nameFromHtml(html: string, host: string): string | null {
  const head = html.slice(0, MAX_BYTES);
  for (const keys of [['og:site_name'], ['application-name'], ['apple-mobile-web-app-title']]) {
    const v = metaContent(head, keys);
    const name = v ? cleanName(v, host) : null;
    if (name) return name;
  }
  const title = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fromTitle = title ? cleanName(title, host) : null;
  if (fromTitle) return fromTitle;
  const ogTitle = metaContent(head, ['og:title']);
  return ogTitle ? cleanName(ogTitle, host) : null;
}

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'ltd', 'plc', 'gc', 'on', 'qc', 'bc']);

/** "portal.acme.com" -> "Acme", "acme-roofing.co.uk" -> "Acme Roofing". */
export function prettyDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').replace(/^www\d*\./, '').split('.').filter(Boolean);
  if (labels.length === 0) return host;
  if (labels.length === 1) return titleCase(labels[0]!);
  const tld = labels[labels.length - 1]!;
  const sld = labels[labels.length - 2]!;
  const coreIndex = tld.length === 2 && SECOND_LEVEL.has(sld) && labels.length >= 3 ? labels.length - 3 : labels.length - 2;
  return titleCase(labels[coreIndex]!.replace(/^xn--/, ''));
}

function titleCase(word: string): string {
  const words = word.split(/[-_]+/).filter(Boolean);
  // Short all-consonant words and a short whole label read as initials: "abc.com" -> "ABC", "hd-supply" -> "HD Supply".
  return words
    .map((w) => (w.length <= 3 && (words.length === 1 || !/[aeiouy]/.test(w)) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

/* ---------------------------------------------------------------- fetch -- */

export type PageFetcher = (url: string) => Promise<string | null>;

function getOnce(url: URL, deadline: number): Promise<{ status: number; location: string | null; html: string | null }> {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) return reject(new Error('timeout'));
    const req = https.get(
      url,
      {
        lookup: publicOnlyLookup as unknown as typeof dns.lookup,
        timeout: left,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; AtmosphereSiteName/1.0; +https://atmosphereteam.com)',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'accept-language': 'en-US,en;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location ?? null, html: null });
        }
        const type = String(res.headers['content-type'] ?? '');
        if (status >= 400 || (type && !/html/i.test(type))) {
          res.resume();
          return resolve({ status, location: null, html: null });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        const finish = () => resolve({ status, location: null, html: Buffer.concat(chunks).toString('utf8') });
        res.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= MAX_BYTES || /<\/head>/i.test(c.toString('latin1'))) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', () => finish());
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('timeout')), left);
    req.on('close', () => clearTimeout(timer));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** https GET of a public page's HTML (head), or null. Never throws. */
export const fetchPublicPage: PageFetcher = async (raw) => {
  const deadline = Date.now() + TIMEOUT_MS;
  let current: URL;
  try {
    current = new URL(raw);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'https:' || (current.port && current.port !== '443')) return null;
    if (current.username || current.password || !hostAllowed(current.hostname)) return null;
    try {
      const r = await getOnce(current, deadline);
      if (r.html !== null) return r.html;
      if (!r.location) return null;
      current = new URL(r.location, current);
    } catch {
      return null;
    }
  }
  return null;
};

/* --------------------------------------------------------------- lookup -- */

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; identity: SiteIdentity }>();

/** Catalog site for a host, only when it's one people can pick (so name and logo match the grid). */
function pickerSiteFor(host: string) {
  const site = catalogSiteForHost(host);
  return site && pickerSites().some((s) => s.id === site.id) ? site : null;
}

/** Name without any network call: catalog name, else prettified domain. */
export function quickSiteName(host: string): string {
  return pickerSiteFor(host)?.name ?? prettyDomain(host);
}

/** Identify a typed address. Returns null when it isn't a usable web address. */
export async function identifySite(
  raw: unknown,
  opts: { fetchPage?: PageFetcher; now?: () => number } = {},
): Promise<SiteIdentity | null> {
  const cleaned = cleanUrl(raw);
  if (!cleaned) return null;
  const u = new URL(cleaned);
  u.protocol = 'https:';
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!hostAllowed(u.hostname) || !/\.[a-z]{2,}$|\.xn--[a-z0-9-]+$/.test(host)) return null;
  const url = u.toString();

  const site = pickerSiteFor(host);
  if (site) {
    return { url, host, name: site.name, source: 'catalog', siteId: site.id, signInUrl: site.signInUrl };
  }

  const now = opts.now ?? Date.now;
  const hit = cache.get(host);
  if (hit && now() - hit.at < CACHE_TTL_MS) return { ...hit.identity, url };

  const html = await (opts.fetchPage ?? fetchPublicPage)(`https://${u.hostname}/`).catch(() => null);
  const pageName = html ? nameFromHtml(html, host) : null;
  const identity: SiteIdentity = {
    url,
    host,
    name: pageName ?? prettyDomain(host),
    source: pageName ? 'page' : 'domain',
    siteId: null,
    signInUrl: null,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(host, { at: now(), identity });
  return identity;
}

/** Test hook. */
export function clearSiteIdentityCache(): void {
  cache.clear();
}
