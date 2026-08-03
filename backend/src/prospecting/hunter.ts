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
 * Hunter.io, as a second vendor in the waterfall.
 *
 * Hunter is worth having next to People Data Labs because the two are good at
 * different things, and a waterfall is only worth building when its members
 * disagree. PDL is a people database: it knows who works where. Hunter is a
 * domain crawler: it knows what a company's addresses look like because it has
 * seen them published, which means it often holds the operations manager at a
 * forty-person restoration firm that no people-database has ever heard of.
 *
 * Two of its endpoints matter here:
 *
 *   /domain-search  — every address Hunter has seen at a company. This is the
 *                     one that feeds pattern inference: it returns the
 *                     evidence a domain's convention is learned from, which is
 *                     exactly what `candidateEmails` needs and what most orgs
 *                     do not yet have enough of in their own CRM.
 *   /email-finder   — one person at one domain, which is the reveal.
 *
 * Hunter also returns its own confidence score, which we keep separate from
 * verification: a vendor's belief and a mail server's answer are different
 * claims, and collapsing them is how "95% confident" ends up meaning nothing.
 */

interface HunterEmail {
  value?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  confidence?: number;
  linkedin?: string;
  phone_number?: string;
}

interface HunterDomainSearch {
  data?: {
    domain?: string;
    organization?: string;
    emails?: HunterEmail[];
  };
}

interface HunterEmailFinder {
  data?: {
    email?: string;
    score?: number;
    position?: string;
    company?: string;
    linkedin_url?: string;
    phone_number?: string;
  };
}

/** Hunter keys people by address, so the address is the stable id. */
function personId(email: string): string {
  return `hunter:${email.toLowerCase()}`;
}

export class HunterProvider implements ContactDataProvider {
  readonly name = 'Hunter';
  readonly sandbox = false;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = config.prospecting.hunterBaseUrl;
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('api_key', this.apiKey);
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.requestTimeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    } catch {
      throw new ProviderError(504, 'Hunter did not respond in time.', 'provider_timeout');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 404) return {} as T;
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(502, 'Hunter rejected our credentials.', 'provider_auth');
    }
    if (res.status === 429) {
      throw new ProviderError(429, 'Hunter is rate limiting us. Try again shortly.', 'provider_rate_limited');
    }
    if (!res.ok) throw new ProviderError(502, `Hunter returned ${res.status}.`, 'provider_error');
    return (await res.json()) as T;
  }

  async verify(): Promise<void> {
    await this.call<unknown>('/v2/account', {});
  }

  /**
   * Hunter searches by company domain, not by free text across the world. A
   * query without one cannot be served, and returning an empty result is
   * honest — the waterfall simply moves on to the next vendor.
   */
  async search(query: ProspectQuery): Promise<ProspectSearchResult> {
    const domain = query.companyDomain?.trim();
    if (!domain) return { matches: [], total: 0 };

    const body = await this.call<HunterDomainSearch>('/v2/domain-search', {
      domain,
      limit: String(Math.min(Math.max(query.limit ?? 25, 1), 100)),
      // Named people only; shared mailboxes are not contacts.
      type: 'personal',
    });

    const org = body.data?.organization ?? null;
    const matches = (body.data?.emails ?? [])
      .filter((e) => e.value && (e.first_name || e.last_name))
      .map<ProspectMatch>((e) => ({
        providerPersonId: personId(e.value as string),
        fullName: [e.first_name, e.last_name].filter(Boolean).join(' '),
        title: e.position ?? null,
        companyName: org,
        companyDomain: domain,
        location: null,
        linkedinUrl: e.linkedin ? `https://linkedin.com/in/${e.linkedin}` : null,
        confidence: typeof e.confidence === 'number' ? e.confidence / 100 : null,
        hasEmail: true,
        hasPhone: Boolean(e.phone_number),
      }));

    // Title filtering is ours: Hunter has no title query, so a caller asking
    // for facilities directors would otherwise get the whole company.
    const wanted = query.titles?.map((t) => t.trim().toLowerCase()).filter(Boolean) ?? [];
    const filtered = wanted.length
      ? matches.filter((m) => wanted.some((t) => (m.title ?? '').toLowerCase().includes(t)))
      : matches;

    return { matches: filtered, total: filtered.length };
  }

  async getPerson(providerPersonId: string): Promise<ProspectMatch | null> {
    // The id IS the address, so identity needs no call and costs nothing.
    const email = providerPersonId.startsWith('hunter:') ? providerPersonId.slice(7) : null;
    if (!email) return null;
    const at = email.lastIndexOf('@');
    if (at <= 0) return null;
    return {
      providerPersonId,
      fullName: '',
      title: null,
      companyName: null,
      companyDomain: email.slice(at + 1),
      location: null,
      linkedinUrl: null,
      confidence: null,
      hasEmail: true,
      hasPhone: false,
    };
  }

  async reveal(providerPersonId: string): Promise<RevealedContact | null> {
    const email = providerPersonId.startsWith('hunter:') ? providerPersonId.slice(7) : null;
    if (!email) return null;
    return {
      providerPersonId,
      email,
      phone: null,
      mobile: null,
      confidence: null,
      costNanos: config.prospecting.hunterCostNanos,
    };
  }

  /**
   * Every address Hunter has seen at a domain, as pattern-inference evidence.
   *
   * This is the quiet unlock. Inference refuses to guess at a domain it has no
   * evidence for, which is correct but means a new customer with an empty CRM
   * gets nothing from it. One domain-search call supplies that evidence, and
   * from then on the org can find people at that company that no vendor sells.
   */
  async knownAddressesAt(domain: string): Promise<Array<{ email: string; fullName: string }>> {
    const body = await this.call<HunterDomainSearch>('/v2/domain-search', {
      domain,
      limit: '100',
      type: 'personal',
    });
    return (body.data?.emails ?? [])
      .filter((e) => e.value && e.first_name && e.last_name)
      .map((e) => ({
        email: e.value as string,
        fullName: `${e.first_name} ${e.last_name}`,
      }));
  }

  /** One person at one company, by name. Hunter's own inference plus its crawl. */
  async findEmail(fullName: string, domain: string): Promise<{ email: string; score: number } | null> {
    const body = await this.call<HunterEmailFinder>('/v2/email-finder', {
      domain,
      full_name: fullName,
    });
    const email = body.data?.email;
    if (!email) return null;
    return { email, score: typeof body.data?.score === 'number' ? body.data.score / 100 : 0.5 };
  }
}
