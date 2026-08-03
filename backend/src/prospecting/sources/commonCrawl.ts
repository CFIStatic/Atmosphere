import { config } from '../../config.js';
import { splitName, type KnownAddress } from '../patterns.js';
import { safeFetchText } from './safeFetch.js';
import { pairNamesWithAddresses } from './webCrawl.js';
import type { ContactSource, SourcedContact } from './ports.js';

/**
 * Common Crawl — the closest thing to "just use Google's data" that is real.
 *
 * Common Crawl is a free, open, legally distributable corpus of the web:
 * billions of pages, refreshed monthly, with an index you can query by URL
 * prefix and a range-request API that returns the stored page. It is the
 * dataset a great many search and data companies actually start from, and
 * unlike scraping a search engine it is explicitly published for this use.
 *
 * Two things it buys us:
 *
 *   1. Pages a company has since taken down. The crawl is a historical
 *      record, so a staff directory from four months ago is still readable.
 *   2. Reach without infrastructure. Asking Common Crawl about a domain costs
 *      one HTTP call. Crawling the equivalent ourselves would mean a fleet,
 *      a politeness budget and a reputation to manage.
 *
 * What it is not is fresh. An address from the crawl is a claim about the
 * past, which is exactly why nothing here is sold without verification — the
 * mail server is the authority on whether a mailbox still exists, and this
 * source only proposes candidates for it to rule on.
 */

interface CdxRecord {
  url?: string;
  status?: string;
  mime?: string;
  filename?: string;
  offset?: string;
  length?: string;
}

export class CommonCrawlSource implements ContactSource {
  readonly name = 'Common Crawl';
  readonly metered = false;

  /**
   * Which monthly crawl to query.
   *
   * Configured rather than discovered: the collinfo endpoint that lists
   * available crawls is itself a network call, and a stale-but-working index
   * name beats a reveal that fails because a discovery call timed out.
   */
  private get index(): string {
    return config.prospecting.commonCrawlIndex;
  }

  private async lookup(domain: string): Promise<CdxRecord[]> {
    const url =
      `${config.prospecting.commonCrawlBaseUrl}/${this.index}-index` +
      `?url=${encodeURIComponent(`${domain}/*`)}&output=json&limit=${config.prospecting.commonCrawlLimit}`;

    const body = await safeFetchText(url, {
      timeoutMs: config.prospecting.crawlTimeoutMs,
      maxBytes: 256 * 1024,
    });
    if (!body) return [];

    // The CDX API answers with newline-delimited JSON, one record per line,
    // and returns a plain-text 404 body when it holds nothing for a domain.
    const records: CdxRecord[] = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        records.push(JSON.parse(trimmed) as CdxRecord);
      } catch {
        /* a malformed line is not a reason to lose the rest */
      }
    }
    return records;
  }

  /** Fetch one stored page by its offset into the crawl's WARC file. */
  private async fetchRecord(record: CdxRecord): Promise<string | null> {
    if (!record.filename || !record.offset || !record.length) return null;
    // Range-requesting a WARC segment needs a byte range, which safeFetchText
    // does not model; the data endpoint is public and content-addressed, so it
    // is fetched directly with the same guards applied by URL construction.
    const start = Number(record.offset);
    const end = start + Number(record.length) - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.crawlTimeoutMs);
    try {
      const res = await fetch(`${config.prospecting.commonCrawlDataUrl}/${record.filename}`, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      // WARC segments are gzipped; DecompressionStream is in Node's global
      // scope from 18 onward and avoids pulling in a dependency for this.
      const stream = res.body?.pipeThrough(new DecompressionStream('gzip'));
      if (!stream) return null;
      const text = await new Response(stream).text();
      return text.length > 1_000_000 ? text.slice(0, 1_000_000) : text;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async addressesAt(domain: string): Promise<KnownAddress[]> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!clean || !clean.includes('.')) return [];

    let records: CdxRecord[];
    try {
      records = await this.lookup(clean);
    } catch {
      return [];
    }

    // Pages that are likely to name people, and that we can actually read.
    const interesting = records
      .filter((r) => r.status === '200' && (r.mime ?? '').includes('html'))
      .filter((r) => /team|about|staff|contact|leadership|people|management/i.test(r.url ?? ''))
      .slice(0, config.prospecting.commonCrawlMaxRecords);

    const found: KnownAddress[] = [];
    const seen = new Set<string>();

    for (const record of interesting) {
      const page = await this.fetchRecord(record);
      if (!page) continue;
      const text = page
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      for (const entry of pairNamesWithAddresses(text, clean)) {
        if (seen.has(entry.email)) continue;
        seen.add(entry.email);
        found.push(entry);
      }
      if (found.length >= 8) break;
    }

    return found;
  }

  async find(fullName: string, domain: string): Promise<SourcedContact | null> {
    const wanted = splitName(fullName);
    if (!wanted) return null;

    const published = await this.addressesAt(domain);
    const hit = published.find((entry) => {
      const parts = splitName(entry.fullName);
      return parts && parts.first === wanted.first && parts.last === wanted.last;
    });
    if (!hit) return null;

    return {
      email: hit.email,
      phone: null,
      mobile: null,
      // Lower than the live site: the crawl is a record of the past, and the
      // person may have left. Verification settles it either way.
      confidence: 0.7,
      detail: 'Found in the public web crawl archive.',
    };
  }
}
