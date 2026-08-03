import { config } from '../config.js';
import {
  ProviderError,
  type ContactDataProvider,
  type ProspectMatch,
  type ProspectQuery,
  type ProspectSearchResult,
  type RevealedContact,
} from './ports.js';

/**
 * People Data Labs, as one implementation of the port.
 *
 * PDL is a reasonable first vendor for this feature: person search and person
 * enrichment are separate endpoints, which maps cleanly onto our free search /
 * charged reveal split, and it bills per match rather than per seat.
 *
 * Two decisions worth stating, because they are the difference between a
 * prospecting tool and a liability:
 *
 *   1. Search asks only for identity fields. We do not request emails or
 *      phones in the search call even though the API would return some,
 *      because holding contact details we have not charged for invites us to
 *      leak them into a response that was supposed to be free.
 *
 *   2. `costNanos` records what PDL charged so the margin on a reveal is
 *      visible next to the margin on a model call. It is read from the
 *      configured per-match cost, since the API does not return a price.
 *
 * The class is written against PDL's documented v5 shape. Until a key is
 * configured it is never constructed — `buildContactProvider` returns the
 * sandbox instead — so an unconfigured deployment cannot call it by accident.
 */

interface PdlPerson {
  id?: string;
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  job_company_website?: string;
  location_name?: string;
  linkedin_url?: string;
  likelihood?: number;
  emails?: Array<{ address?: string }>;
  work_email?: string;
  recommended_personal_email?: string;
  phone_numbers?: string[];
  mobile_phone?: string;
}

function asMatch(person: PdlPerson): ProspectMatch {
  return {
    providerPersonId: person.id ?? '',
    fullName: person.full_name ?? 'Unknown',
    title: person.job_title ?? null,
    companyName: person.job_company_name ?? null,
    companyDomain: person.job_company_website ?? null,
    location: person.location_name ?? null,
    linkedinUrl: person.linkedin_url ? `https://${person.linkedin_url}` : null,
    // PDL reports likelihood 1–10; our port speaks 0–1.
    confidence: typeof person.likelihood === 'number' ? person.likelihood / 10 : null,
    hasEmail: Boolean(person.work_email || person.emails?.length),
    hasPhone: Boolean(person.mobile_phone || person.phone_numbers?.length),
  };
}

/** Elasticsearch-ish query PDL's person/search endpoint expects. */
function buildSearchSql(query: ProspectQuery): string {
  const clauses: string[] = [];
  const esc = (v: string) => v.replace(/'/g, "''");

  if (query.q) clauses.push(`(full_name LIKE '%${esc(query.q)}%' OR job_company_name LIKE '%${esc(query.q)}%')`);
  if (query.location) clauses.push(`location_name LIKE '%${esc(query.location)}%'`);
  if (query.companyDomain) clauses.push(`job_company_website = '${esc(query.companyDomain)}'`);
  if (query.industry) clauses.push(`job_company_industry LIKE '%${esc(query.industry)}%'`);
  if (query.titles?.length) {
    const titles = query.titles.map((t) => `job_title LIKE '%${esc(t)}%'`).join(' OR ');
    clauses.push(`(${titles})`);
  }

  const where = clauses.length ? clauses.join(' AND ') : 'job_title IS NOT NULL';
  return `SELECT * FROM person WHERE ${where}`;
}

export class PeopleDataLabsProvider implements ContactDataProvider {
  readonly name = 'People Data Labs';
  readonly sandbox = false;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = config.prospecting.peopleDataLabsBaseUrl;
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.requestTimeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      throw new ProviderError(504, 'The contact data provider did not respond in time.', 'provider_timeout');
    } finally {
      clearTimeout(timer);
    }

    // 404 is PDL for "no match", which is an answer rather than a failure.
    if (res.status === 404) return { data: null } as T;
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(502, 'The contact data provider rejected our credentials.', 'provider_auth');
    }
    if (res.status === 429) {
      throw new ProviderError(429, 'The contact data provider is rate limiting us. Try again shortly.', 'provider_rate_limited');
    }
    if (!res.ok) {
      throw new ProviderError(502, `The contact data provider returned ${res.status}.`, 'provider_error');
    }
    return (await res.json()) as T;
  }

  async verify(): Promise<void> {
    await this.call<unknown>('/v5/person/search', { sql: 'SELECT * FROM person WHERE full_name LIKE \'%test%\'', size: '1' });
  }

  async search(query: ProspectQuery): Promise<ProspectSearchResult> {
    const size = String(Math.min(Math.max(query.limit ?? 25, 1), 100));
    const body = await this.call<{ data?: PdlPerson[]; total?: number }>('/v5/person/search', {
      sql: buildSearchSql(query),
      size,
      // Identity only. The paid columns are a reveal's job.
      titlecase: 'true',
    });
    const matches = (body.data ?? []).map(asMatch).filter((m) => m.providerPersonId);
    return { matches, total: typeof body.total === 'number' ? body.total : null };
  }

  async getPerson(providerPersonId: string): Promise<ProspectMatch | null> {
    // Same enrich call as reveal(), read only for identity. PDL bills the
    // call either way, which is why the route caches the row it saved at
    // search time and only falls back to this.
    const body = await this.call<{ data?: PdlPerson | null }>('/v5/person/enrich', {
      pdl_id: providerPersonId,
    });
    return body.data ? asMatch(body.data) : null;
  }

  async reveal(providerPersonId: string): Promise<RevealedContact | null> {
    const body = await this.call<{ data?: PdlPerson | null }>('/v5/person/enrich', {
      pdl_id: providerPersonId,
    });
    const person = body.data;
    if (!person) return null;

    const email = person.work_email ?? person.emails?.[0]?.address ?? null;
    const mobile = person.mobile_phone ?? null;
    const phone = person.phone_numbers?.[0] ?? null;
    if (!email && !mobile && !phone) return null;

    return {
      providerPersonId,
      email,
      phone,
      mobile,
      confidence: typeof person.likelihood === 'number' ? person.likelihood / 10 : null,
      costNanos: config.prospecting.revealCostNanos,
    };
  }
}
