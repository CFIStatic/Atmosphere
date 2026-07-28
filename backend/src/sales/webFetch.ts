import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseHttpUrl } from '../lib/webUrlGuard.js';

/**
 * Safe public-page fetcher for Sales Agent research.
 *
 * SSRF rules match Web Access: only http(s), resolve the host, refuse private
 * addresses. Returns plain text + a trimmed HTML excerpt suitable for parsing.
 */

const USER_AGENT =
  'Mozilla/5.0 (compatible; AtmosphereOutreach/1.0; +https://atmosphere.app)';

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (normalized.startsWith('fe80')) return true;
  if (/^f[cd]/.test(normalized)) return true;
  return false;
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = parseHttpUrl(raw);
  if (!url) throw new Error(`Unsupported URL: ${raw}`);
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    throw new Error('Local hosts are blocked');
  }
  const literal = isIP(url.hostname);
  const addresses = literal
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => {
    const family = isIP(a.address);
    if (family === 4) return isPrivateIPv4(a.address);
    if (family === 6) return isPrivateIPv6(a.address);
    return true;
  })) {
    throw new Error(`Refusing private/unresolvable host: ${url.hostname}`);
  }
  return url;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  html: string;
  ok: boolean;
  status?: number;
  error?: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 300) : '';
}

/** Fetch with plain HTTP first; fall back to Playwright for JS-heavy pages. */
export async function fetchPublicPage(
  rawUrl: string,
  options: { timeoutMs?: number; preferBrowser?: boolean } = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  let url: URL;
  try {
    url = await assertPublicHttpUrl(rawUrl);
  } catch (err) {
    return {
      url: rawUrl,
      finalUrl: rawUrl,
      title: '',
      text: '',
      html: '',
      ok: false,
      error: err instanceof Error ? err.message : 'bad_url',
    };
  }

  if (!options.preferBrowser) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const html = (await res.text()).slice(0, 500_000);
      if (res.ok && html.length > 200) {
        return {
          url: rawUrl,
          finalUrl: res.url || url.toString(),
          title: pageTitle(html),
          text: htmlToText(html).slice(0, 80_000),
          html,
          ok: true,
          status: res.status,
        };
      }
    } catch {
      // fall through to Playwright
    }
  }

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent: USER_AGENT,
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      });
      const response = await page.goto(url.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      const html = (await page.content()).slice(0, 500_000);
      const text = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (globalThis as any).document;
        return String(doc?.body?.innerText ?? '');
      });
      return {
        url: rawUrl,
        finalUrl: page.url(),
        title: pageTitle(html) || (await page.title()),
        text: String(text).replace(/\s+/g, ' ').trim().slice(0, 80_000),
        html,
        ok: true,
        status: response?.status(),
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    return {
      url: rawUrl,
      finalUrl: url.toString(),
      title: '',
      text: '',
      html: '',
      ok: false,
      error: err instanceof Error ? err.message : 'fetch_failed',
    };
  }
}

export async function postForm(
  rawUrl: string,
  form: Record<string, string>,
  options: { timeoutMs?: number } = {},
): Promise<FetchedPage> {
  let url: URL;
  try {
    url = await assertPublicHttpUrl(rawUrl);
  } catch (err) {
    return {
      url: rawUrl,
      finalUrl: rawUrl,
      title: '',
      text: '',
      html: '',
      ok: false,
      error: err instanceof Error ? err.message : 'bad_url',
    };
  }

  try {
    const body = new URLSearchParams(form).toString();
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    });
    const html = (await res.text()).slice(0, 500_000);
    return {
      url: rawUrl,
      finalUrl: res.url || url.toString(),
      title: pageTitle(html),
      text: htmlToText(html).slice(0, 80_000),
      html,
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      url: rawUrl,
      finalUrl: url.toString(),
      title: '',
      text: '',
      html: '',
      ok: false,
      error: err instanceof Error ? err.message : 'post_failed',
    };
  }
}
