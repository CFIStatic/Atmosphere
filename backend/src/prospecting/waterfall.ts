import { candidateEmails, type KnownAddress } from './patterns.js';
import type { ContactSource } from './sources/ports.js';
import { labelPhones, type LabelledPhone, type RawPhone } from './phone/index.js';
import { verifyEmail, type VerificationResult } from './verification.js';
import { config } from '../config.js';
import type { ContactDataProvider, RevealedContact } from './ports.js';

/**
 * Waterfall enrichment — the thing that actually moves the match rate.
 *
 * No single vendor holds everybody. The published hit rates for one provider
 * on a mixed B2B list sit somewhere in the fifties; ask three in sequence and
 * take the first hit and you are well past that. Every serious contact-data
 * product does this, and it is the difference between a tool that works on a
 * demo list and one that works on a customer's territory.
 *
 * The order is deliberate — free first, then cheapest, then most speculative:
 *
 *   0. The free sources: the shared network, the company's own website, the
 *      public web archive. None of these bill anybody.
 *   1. Each configured vendor, in turn, until one answers.
 *   2. Pattern inference against the company domain, verified.
 *
 * Putting step 0 first is the economics of the whole feature. A free answer
 * and a paid answer are worth exactly the same to the customer, so every hit
 * up there is margin that would otherwise have gone to a data vendor.
 *
 * Step 0 also feeds step 2, which is the part that compounds. Inference
 * refuses to guess at a domain it has no evidence for — correct, but it meant
 * a customer with an empty CRM got nothing from it. Now one crawl of a
 * company's team page teaches us that company's convention permanently, and
 * from then on we can find people there that no database sells: the small
 * property-management firm's operations manager is in nobody's dataset, but
 * his employer uses `first.last@` like everyone else, and a mail server will
 * say whether that mailbox exists.
 *
 * Two rules hold the billing story together:
 *
 *   - Nothing is returned unverified. Every address goes through the same
 *     ladder and carries its verdict, so 'risky' is never sold as 'valid'.
 *   - A run that finds nothing returns null, and the caller charges nothing.
 *     Failed attempts cost us DNS lookups and cost the customer zero.
 */

export interface WaterfallInput {
  providerPersonId: string;
  fullName: string;
  companyDomain: string | null;
  /** The org's own known addresses, used to learn the domain's convention. */
  knownAddresses?: KnownAddress[];
  /**
   * Free sources, asked before any vendor is billed. They also supply the
   * domain evidence pattern inference refuses to guess without, which is what
   * makes the engine work for an organization whose own CRM is still empty.
   */
  sources?: ContactSource[];
}

export interface WaterfallResult extends RevealedContact {
  /** 'People Data Labs', 'Sandbox', or 'Pattern + verification'. */
  source: string;
  verification: VerificationResult | null;
  /** Every address tried and what came back — the audit trail for a reveal. */
  attempts: Array<{ email: string; verdict: string; source: string }>;
  /**
   * Every number, normalised, carrier-checked and labelled work / mobile /
   * personal. The flat `phone` and `mobile` fields above are kept in step for
   * anything already reading them, but this is the honest version: it says
   * which number is which and whether anybody confirmed it.
   */
  phones: LabelledPhone[];
}

/** Verdicts we are willing to hand a customer and charge for. */
function sellable(result: VerificationResult): boolean {
  if (result.verdict === 'valid') return true;
  // A catch-all domain can never be confirmed; it is still the right address
  // far more often than not, so it is offered — labelled — rather than binned.
  if (result.verdict === 'risky' && result.catchAll) return true;
  // An address nothing could confirm is sold only where a deployment has
  // explicitly opted into that. This used to be the default whenever SMTP
  // probing was off, which meant the out-of-the-box configuration billed for
  // addresses whose only credential was that the domain had an MX record.
  // Selling a vendor's assertion as a verified contact is the failure mode
  // this whole file exists to prevent.
  if (result.verdict === 'unknown' && config.prospecting.sellUnverified) return true;
  return false;
}

/** Everything except the labelled numbers, which are added on the way out. */
type ResolvedContact = Omit<WaterfallResult, 'phones'>;

/**
 * Where a number came from, which is what carrier data cannot tell us.
 *
 * A lookup says "mobile"; it cannot say whether that mobile is the one on the
 * company's contact page or the one the person gives their family. The source
 * that produced the number is the only evidence we have for that, so it is
 * what decides the label.
 */
function provenanceFor(source: string, field: 'work' | 'mobile'): RawPhone['provenance'] {
  // Published by the company itself, for the express purpose of being called.
  if (source === 'Company website' || source === 'Common Crawl') return 'published';
  if (source === 'Shared network') return 'network';
  return field === 'mobile' ? 'vendor_mobile' : 'vendor_work';
}

export async function runWaterfall(
  providers: ContactDataProvider[],
  input: WaterfallInput,
): Promise<WaterfallResult | null> {
  const found = await resolveContact(providers, input);
  if (!found) return null;

  // Labelling happens once, here, rather than at each of the half-dozen places
  // a contact can be returned from — so a new source cannot forget to do it.
  const raw: RawPhone[] = [];
  if (found.phone) {
    raw.push({ number: found.phone, provenance: provenanceFor(found.source, 'work'), source: found.source });
  }
  if (found.mobile) {
    raw.push({ number: found.mobile, provenance: provenanceFor(found.source, 'mobile'), source: found.source });
  }

  return { ...found, phones: await labelPhones(raw) };
}

async function resolveContact(
  providers: ContactDataProvider[],
  input: WaterfallInput,
): Promise<ResolvedContact | null> {
  const attempts: WaterfallResult['attempts'] = [];
  const domain = input.companyDomain?.trim().toLowerCase() ?? '';

  // Evidence accumulates as we go: anything a free source publishes at this
  // domain teaches pattern inference the company's convention, whether or not
  // it happened to hold the person we asked about.
  const evidence: KnownAddress[] = [...(input.knownAddresses ?? [])];

  // ---- 0. The free sources, before anything is billed ---------------------
  //
  // A free answer and a paid answer are worth exactly the same to the customer.
  // Asking here first is the difference between a reveal that costs us three
  // cents and one that costs us nothing.
  for (const source of input.sources ?? []) {
    if (!domain) break;

    let published: KnownAddress[] = [];
    try {
      published = await source.addressesAt(domain);
    } catch {
      // A source that is down, blocked, or slow is not an error worth failing
      // a reveal over — it simply had nothing.
      published = [];
    }
    for (const entry of published) {
      if (!evidence.some((e) => e.email.toLowerCase() === entry.email.toLowerCase())) {
        evidence.push(entry);
      }
    }

    let hit: Awaited<ReturnType<ContactSource['find']>> = null;
    try {
      hit = await source.find(input.fullName, domain);
    } catch {
      hit = null;
    }
    if (!hit?.email) continue;

    const verification = await verifyEmail(hit.email);
    attempts.push({ email: hit.email, verdict: verification.verdict, source: source.name });
    if (!sellable(verification)) continue;

    return {
      providerPersonId: input.providerPersonId,
      email: hit.email,
      phone: hit.phone,
      mobile: hit.mobile,
      confidence: verification.score,
      // Nobody was paid, so this reveal costs us nothing but a lookup.
      costNanos: 0,
      source: source.name,
      verification,
      attempts,
    };
  }

  // ---- 1. The vendors, in order -------------------------------------------
  for (const provider of providers) {
    let contact: RevealedContact | null = null;
    try {
      contact = await provider.reveal(input.providerPersonId);
    } catch {
      // A vendor being down is not a reason to stop asking the next one.
      continue;
    }
    if (!contact) continue;

    if (!contact.email) {
      // A phone with no email is still worth having, and there is nothing to
      // verify — no verifier has an opinion about phone numbers.
      if (contact.phone || contact.mobile) {
        return { ...contact, source: provider.name, verification: null, attempts };
      }
      continue;
    }

    if (provider.sandbox) {
      // Synthetic people live on reserved domains that by definition have no
      // mail server, so verification can only ever fail. Running it anyway
      // would leave sandbox mode returning phone numbers and no addresses,
      // which teaches an operator nothing about how the real path behaves.
      // The verdict says plainly that nothing was checked.
      attempts.push({ email: contact.email, verdict: 'sandbox', source: provider.name });
      return {
        ...contact,
        source: provider.name,
        verification: {
          email: contact.email,
          verdict: 'unknown',
          score: 0.5,
          reason: 'Sample data — not a real mailbox and never verified.',
          catchAll: false,
          noMx: false,
          verifier: null,
        },
        attempts,
      };
    }

    const verification = await verifyEmail(contact.email);
    attempts.push({ email: contact.email, verdict: verification.verdict, source: provider.name });

    if (sellable(verification)) {
      return {
        ...contact,
        // Never return an address our own ladder just called invalid.
        email: contact.email,
        confidence: verification.score,
        source: provider.name,
        verification,
        attempts,
      };
    }

    // The vendor's address is dead. Keep their phone number if they gave one,
    // but carry on looking for a working address.
    if (contact.phone || contact.mobile) {
      return {
        ...contact,
        email: null,
        source: provider.name,
        verification,
        attempts,
      };
    }
  }

  // ---- 2. Pattern inference, verified -------------------------------------
  if (!config.prospecting.patternInferenceEnabled) return null;
  if (!domain) return null;

  // `evidence`, not just the org's own addresses: everything the free sources
  // published at this domain counts. That is the whole unlock — inference
  // refuses to guess without evidence, so a customer with an empty CRM used to
  // get nothing from it, and now a single crawl fixes that for the domain.
  const candidates = candidateEmails(
    input.fullName,
    domain,
    evidence,
    config.prospecting.maxPatternCandidates,
  );

  for (const candidate of candidates) {
    const verification = await verifyEmail(candidate);
    attempts.push({ email: candidate, verdict: verification.verdict, source: 'pattern' });

    // On a catch-all domain every candidate "passes", so the first guess would
    // win by default and be presented as found. That is a coin flip dressed as
    // a result, so pattern inference stops there and reports nothing.
    if (verification.catchAll) break;

    if (verification.verdict === 'valid') {
      return {
        providerPersonId: input.providerPersonId,
        email: candidate,
        phone: null,
        mobile: null,
        confidence: verification.score,
        // No vendor was paid, so this reveal costs us nothing but a DNS lookup.
        costNanos: 0,
        source: 'Pattern + verification',
        verification,
        attempts,
      };
    }
  }

  return null;
}
