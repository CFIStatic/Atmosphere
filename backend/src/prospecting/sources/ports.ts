import type { KnownAddress } from '../patterns.js';

/**
 * The contact-source port — the half of the waterfall nobody bills for.
 *
 * `ContactDataProvider` models a vendor: you ask it about a person by their
 * id and it charges you. That shape does not fit the free sources, which are
 * domain-oriented rather than person-oriented. You do not ask Common Crawl
 * about a person; you ask it what addresses exist at a company, and reason
 * from there.
 *
 * So a source answers two questions:
 *
 *   addressesAt(domain) — every address published at this company. This is
 *                         evidence, and it is the more valuable of the two:
 *                         pattern inference refuses to guess at a domain it
 *                         has no evidence for, which means a customer with an
 *                         empty CRM got nothing from it. One source call fixes
 *                         that permanently for that domain.
 *
 *   find(name, domain)  — a direct hit, when the source happens to hold the
 *                         person outright.
 *
 * Sources run before vendors in the waterfall, because a free answer and a
 * paid answer are worth the same to the customer and very different to us.
 */

export interface SourcedContact {
  email: string | null;
  phone: string | null;
  mobile: string | null;
  /** 0–1, the source's own belief. Verification is a separate claim. */
  confidence: number | null;
  /** Where this came from, in words a customer can be shown. */
  detail?: string;
}

export interface ContactSource {
  /** 'Company website', 'Common Crawl', 'Shared network'. */
  readonly name: string;
  /** True when asking costs money. Every source here is false; vendors are not. */
  readonly metered: boolean;

  /**
   * Addresses published at this domain, as pattern-inference evidence.
   *
   * Must never throw: a source that is down or blocked returns an empty list,
   * and the waterfall moves on.
   */
  addressesAt(domain: string): Promise<KnownAddress[]>;

  /** A direct hit for this person, or null. Must never throw. */
  find(fullName: string, domain: string): Promise<SourcedContact | null>;
}
