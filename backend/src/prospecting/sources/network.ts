import { splitName, type KnownAddress } from '../patterns.js';
import type { ContactSource, SourcedContact } from './ports.js';

/**
 * The shared contact network, as a source.
 *
 * Every opted-in organization contributes the business contacts it already
 * holds, and every organization can find people in the pool the others
 * filled. It compounds: the product gets better at finding restoration
 * buyers specifically, because the people using it are all selling to them.
 *
 * The ranking signal here is corroboration. When three organizations that
 * have never met have independently recorded the same address for the same
 * person, that is a stronger claim than any single vendor's assertion — and
 * unlike a vendor's confidence score, it is a fact about the world rather
 * than a number somebody chose.
 *
 * The consent machinery lives in SQL (20260803090000_contact_network.sql):
 * opt-in per org, business addresses enforced by constraint, and erasure
 * tombstones that survive re-contribution. This class is the read side, and
 * it goes through the service-role client because the pool is deliberately
 * not readable by tenants directly — a direct SELECT over every pooled
 * contact is the database the product sells, handed over a page at a time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export class NetworkContactSource implements ContactSource {
  readonly name = 'Shared network';
  readonly metered = false;

  private readonly admin: any;
  /** The org asking. Its own contributions are excluded from its results. */
  private readonly orgId: string;

  constructor(adminClient: any, orgId: string) {
    this.admin = adminClient;
    this.orgId = orgId;
  }

  async addressesAt(domain: string): Promise<KnownAddress[]> {
    const clean = domain.trim().toLowerCase();
    if (!clean) return [];

    const { data, error } = await this.admin
      .from('network_contacts')
      .select('email, full_name')
      .eq('domain', clean)
      .order('corroborations', { ascending: false })
      .limit(50);
    if (error || !data) return [];

    const seen = new Set<string>();
    const out: KnownAddress[] = [];
    for (const row of data) {
      const email = String(row.email ?? '').toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, fullName: String(row.full_name ?? '') });
    }
    return out;
  }

  async find(fullName: string, domain: string): Promise<SourcedContact | null> {
    const wanted = splitName(fullName);
    const clean = domain.trim().toLowerCase();
    if (!wanted || !clean) return null;

    const { data, error } = await this.admin
      .from('network_contacts')
      .select('email, full_name, phone, mobile, corroborations, contributed_by')
      .eq('domain', clean)
      .order('corroborations', { ascending: false })
      .limit(50);
    if (error || !data) return null;

    const hit = data.find((row: any) => {
      // Never sell an org a row it contributed itself. They already have it,
      // and billing someone for their own data laundered through the pool is
      // exactly the trick this product is not going to run.
      if (row.contributed_by === this.orgId) return false;
      const parts = splitName(String(row.full_name ?? ''));
      return parts && parts.first === wanted.first && parts.last === wanted.last;
    });
    if (!hit) return null;

    // Independent agreement is the confidence. One org saying so is a claim;
    // three unaffiliated orgs saying so is close to a fact.
    const corroborations = Number(hit.corroborations ?? 1);
    const confidence = Math.min(0.6 + 0.1 * (corroborations - 1), 0.9);

    return {
      email: String(hit.email),
      phone: hit.phone ?? null,
      mobile: hit.mobile ?? null,
      confidence,
      detail:
        corroborations > 1
          ? `Recorded by ${corroborations} organizations independently.`
          : 'Recorded by another organization.',
    };
  }
}
