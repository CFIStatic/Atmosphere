import { config } from '../../config.js';
import type { Connector, ExternalRecord, FetchContext, FetchResult } from './types.js';

/**
 * A generic JSON-over-HTTP connector.
 *
 * Deliberately not a connector for one named product. The applications a
 * restoration company runs on differ per company and change every couple of
 * years; hard-coding one vendor's API would mean a code change and a deploy to
 * mirror the next one. Instead the shape of the API is configuration, and a new
 * system becomes a row in `crm_external_sources`.
 *
 * Source `config` shape:
 *
 * ```jsonc
 * {
 *   "baseUrl": "https://api.example.com",
 *   "auth": "bearer",            // bearer | header | query | none
 *   "authHeader": "X-Api-Key",   // when auth = header
 *   "authQueryParam": "api_key", // when auth = query
 *   "entities": [
 *     {
 *       "type": "claim",              // stored as entity_type
 *       "path": "/v2/claims",
 *       "idField": "id",              // where the vendor's key lives
 *       "updatedField": "updated_at", // optional
 *       "dataPath": "data",           // where the array lives in the response
 *       "pagination": "page",         // page | offset | cursor | none
 *       "pageParam": "page",
 *       "sizeParam": "per_page",
 *       "pageSize": 100,
 *       "cursorPath": "meta.next_cursor",
 *       "cursorParam": "cursor",
 *       "query": { "status": "all" }  // extra static query params
 *     }
 *   ]
 * }
 * ```
 *
 * Only http(s) URLs are accepted, and the base URL is validated before any
 * request is made: a connector is a server-side fetcher driven by user-supplied
 * configuration, which is exactly the shape of a server-side request forgery if
 * left unchecked.
 */

interface EntityConfig {
  type: string;
  path: string;
  idField?: string;
  updatedField?: string;
  dataPath?: string;
  pagination?: 'page' | 'offset' | 'cursor' | 'none';
  pageParam?: string;
  sizeParam?: string;
  pageSize?: number;
  cursorPath?: string;
  cursorParam?: string;
  query?: Record<string, string>;
}

/** Walks a dotted path through a parsed JSON body. */
function dig(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/**
 * Rejects anything that is not a plain public HTTP(S) endpoint.
 *
 * The blocked hosts are the ones that make SSRF worth attempting: loopback,
 * link-local (which is where cloud instance-metadata credentials live), and the
 * private ranges where internal services sit. Without this, a member who can
 * create a source could point the server at its own metadata endpoint and read
 * back whatever it returns through the mirror.
 */
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid baseUrl: ${raw}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol in baseUrl: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host);

  if (blocked) {
    throw new Error(`Refusing to call a private or loopback address: ${host}`);
  }

  return url;
}

export class RestConnector implements Connector {
  readonly kind = 'rest';

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const cfg = ctx.config as {
      baseUrl?: string;
      auth?: string;
      authHeader?: string;
      authQueryParam?: string;
      entities?: EntityConfig[];
    };

    if (!cfg.baseUrl) throw new Error('REST source config needs a baseUrl.');
    const base = assertSafeUrl(cfg.baseUrl);

    const entities = cfg.entities ?? [];
    if (entities.length === 0) throw new Error('REST source config needs at least one entity.');

    const records: ExternalRecord[] = [];
    let truncated = false;

    for (const entity of entities) {
      if (records.length >= ctx.maxRecords) {
        truncated = true;
        break;
      }
      const got = await this.fetchEntity(base, cfg, entity, ctx, ctx.maxRecords - records.length);
      records.push(...got.records);
      if (got.truncated) truncated = true;
    }

    // Timestamp cursor: next run asks only for what changed since this one. A
    // connector whose vendor exposes no updated-at simply re-reads everything,
    // which the content-hash check downstream makes cheap.
    return {
      records,
      nextCursor: truncated ? ctx.cursor : new Date().toISOString(),
      truncated,
    };
  }

  private async fetchEntity(
    base: URL,
    cfg: { auth?: string; authHeader?: string; authQueryParam?: string },
    entity: EntityConfig,
    ctx: FetchContext,
    budget: number,
  ): Promise<{ records: ExternalRecord[]; truncated: boolean }> {
    const idField = entity.idField ?? 'id';
    const pageSize = Math.min(entity.pageSize ?? 100, 500);
    const mode = entity.pagination ?? 'page';

    const out: ExternalRecord[] = [];
    let page = 1;
    let offset = 0;
    let cursor: string | null = null;
    let truncated = false;

    // A vendor that always returns a next-page token would otherwise loop
    // forever. The budget stops it, and this stops a broken budget.
    const MAX_PAGES = 1000;

    for (let iteration = 0; iteration < MAX_PAGES; iteration += 1) {
      const url = new URL(entity.path.replace(/^\//, ''), base.href.endsWith('/') ? base.href : `${base.href}/`);

      for (const [key, value] of Object.entries(entity.query ?? {})) url.searchParams.set(key, value);

      if (mode === 'page') {
        url.searchParams.set(entity.pageParam ?? 'page', String(page));
        url.searchParams.set(entity.sizeParam ?? 'per_page', String(pageSize));
      } else if (mode === 'offset') {
        url.searchParams.set(entity.pageParam ?? 'offset', String(offset));
        url.searchParams.set(entity.sizeParam ?? 'limit', String(pageSize));
      } else if (mode === 'cursor' && cursor) {
        url.searchParams.set(entity.cursorParam ?? 'cursor', cursor);
      }

      // Incremental pull when both sides support it.
      if (ctx.cursor && entity.updatedField) {
        url.searchParams.set('updated_since', ctx.cursor);
      }

      const headers: Record<string, string> = { Accept: 'application/json' };

      if (ctx.credential) {
        switch (cfg.auth) {
          case 'header':
            headers[cfg.authHeader ?? 'X-Api-Key'] = ctx.credential;
            break;
          case 'query':
            url.searchParams.set(cfg.authQueryParam ?? 'api_key', ctx.credential);
            break;
          case 'none':
            break;
          case 'bearer':
          default:
            headers.Authorization = `Bearer ${ctx.credential}`;
        }
      }

      const timeout = AbortSignal.timeout(config.integrations.requestTimeoutMs);
      const response = await globalThis.fetch(url, {
        headers,
        signal: AbortSignal.any([ctx.signal, timeout]),
        redirect: 'error', // a redirect could land us somewhere assertSafeUrl rejected
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `${entity.type}: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        );
      }

      const body = (await response.json()) as unknown;
      const rows = dig(body, entity.dataPath);

      if (!Array.isArray(rows)) {
        throw new Error(
          `${entity.type}: expected an array at "${entity.dataPath ?? '<root>'}" but got ${typeof rows}.`,
        );
      }
      if (rows.length === 0) break;

      for (const row of rows) {
        if (out.length >= budget) {
          truncated = true;
          break;
        }
        const record = row as Record<string, unknown>;
        const externalId = record[idField];
        if (externalId === undefined || externalId === null || externalId === '') {
          // Without a stable key the mirror cannot version this record, and
          // every sync would append a duplicate. Skipping is the honest choice.
          continue;
        }
        out.push({
          entityType: entity.type,
          externalId: String(externalId),
          payload: record,
          sourceUpdatedAt: entity.updatedField ? (record[entity.updatedField] as string | null) ?? null : null,
        });
      }

      if (truncated || mode === 'none') break;

      if (mode === 'cursor') {
        const next = dig(body, entity.cursorPath ?? 'next_cursor');
        if (!next) break;
        cursor = String(next);
      } else if (rows.length < pageSize) {
        break;
      } else {
        page += 1;
        offset += rows.length;
      }
    }

    return { records: out, truncated };
  }
}
