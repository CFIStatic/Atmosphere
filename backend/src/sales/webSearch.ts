import { fetchPublicPage, postForm } from './webFetch.js';

/**
 * Public web search for the Sales Agent people-finder.
 *
 * Uses DuckDuckGo's HTML endpoint (POST) as the primary index — no API key —
 * and falls back to Bing HTML if DDG returns nothing. Results are unwrapped
 * from redirectors so crawlers hit the real destination.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  engine: 'duckduckgo' | 'bing' | 'wikipedia';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function unwrapRedirect(raw: string): string | null {
  try {
    const href = raw.startsWith('//')
      ? `https:${raw}`
      : raw.startsWith('/')
        ? `https://duckduckgo.com${raw}`
        : raw;
    const url = new URL(href);
    const uddg = url.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    const u = url.searchParams.get('u');
    if (u && /^https?:/i.test(u)) return u;
    // Bing ck/a redirect — keep only when we already have a clean https link elsewhere.
    if (url.hostname.includes('bing.com') && url.pathname.includes('/ck/')) return null;
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    return null;
  } catch {
    return null;
  }
}

function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const re =
    /<a[^>]*rel="nofollow"[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/(?:td|div)>)/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const url = unwrapRedirect(match[1]);
    if (!url) continue;
    const title = stripTags(match[2]);
    const snippet = stripTags(match[3] || match[4] || '');
    if (!title) continue;
    hits.push({ title, url, snippet, engine: 'duckduckgo' });
  }

  if (hits.length) return dedupe(hits);

  // Looser fallback: any result__a link.
  const loose = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = loose.exec(html)) !== null) {
    const url = unwrapRedirect(match[1]);
    if (!url) continue;
    hits.push({
      title: stripTags(match[2]),
      url,
      snippet: '',
      engine: 'duckduckgo',
    });
  }
  return dedupe(hits);
}

function decodeBingRedirect(rawHref: string): string | null {
  try {
    const href = rawHref.replace(/&amp;/g, '&');
    const url = new URL(href);
    const u = url.searchParams.get('u');
    if (!u) return null;
    // Bing encodes the destination as a1 + base64(url)
    const payload = u.startsWith('a1') ? u.slice(2) : u;
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

function parseBing(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url = decodeBingRedirect(link[1]) || unwrapRedirect(link[1].replace(/&amp;/g, '&'));
    if (!url || /bing\.com\/ck\//i.test(url)) {
      const cite = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
      if (cite) {
        const visible = stripTags(cite[1])
          .replace(/\s*[›>]\s*/g, '/')
          .replace(/\s+/g, '')
          .replace(/^(https?:\/\/)?/i, 'https://');
        if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(visible)) {
          url = visible.replace(/\/+$/, '');
        }
      }
    }
    if (!url || /bing\.com\//i.test(url)) continue;
    const snippetMatch =
      block.match(/class="b_caption"[\s\S]*?<p>([\s\S]*?)<\/p>/i) ||
      block.match(/class="b_lineclamp\d+"[^>]*>([\s\S]*?)<\//i);
    hits.push({
      title: stripTags(link[2]),
      url,
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
      engine: 'bing',
    });
  }
  return dedupe(hits);
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

export async function searchWeb(query: string, limit = 10): Promise<SearchHit[]> {
  const ddg = await postForm('https://html.duckduckgo.com/html/', { q: query, b: '' });
  let hits = ddg.ok ? parseDuckDuckGo(ddg.html) : [];

  // DuckDuckGo often serves an empty "lite" challenge page to datacenter IPs.
  // Fall back to Bing with decoded redirect URLs.
  if (hits.length < 3) {
    const bing = await fetchPublicPage(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`,
    );
    if (bing.ok) hits = dedupe([...hits, ...parseBing(bing.html)]);
  }

  // Last resort: drive DuckDuckGo HTML through Playwright (real browser UA).
  if (hits.length < 2) {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          userAgent:
            'Mozilla/5.0 (compatible; AtmosphereSalesAgent/1.0; +https://atmosphere.app)',
        });
        await page.goto('https://html.duckduckgo.com/html/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        await page.fill('input[name="q"]', query);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null),
          page.click('input[type="submit"]'),
        ]);
        const html = await page.content();
        hits = dedupe([...hits, ...parseDuckDuckGo(html)]);
      } finally {
        await browser.close();
      }
    } catch {
      // ignore — Bing results may already be enough
    }
  }

  return hits.slice(0, limit);
}

export async function searchWikipedia(query: string): Promise<SearchHit[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AtmosphereSalesAgent/1.0' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[], string[], string[]];
    const titles = data[1] ?? [];
    const urls = data[3] ?? [];
    return titles.map((title, i) => ({
      title,
      url: urls[i],
      snippet: '',
      engine: 'wikipedia' as const,
    })).filter((h) => h.url);
  } catch {
    return [];
  }
}
