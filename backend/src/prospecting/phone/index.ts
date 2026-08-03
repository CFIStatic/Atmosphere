import { config } from '../../config.js';
import { NumverifyVerifier } from './numverify.js';
import { TwilioLookupVerifier } from './twilioLookup.js';
import { toE164 } from './normalize.js';
import type { LabelledPhone, PhoneKind, PhoneVerifier } from './ports.js';

export * from './ports.js';
export * from './normalize.js';
export { TwilioLookupVerifier } from './twilioLookup.js';
export { NumverifyVerifier } from './numverify.js';

/** Whichever lookup is configured, best first. Null when none is. */
export function buildPhoneVerifier(): PhoneVerifier | null {
  const p = config.prospecting;
  if (p.twilioAccountSid && p.twilioAuthToken) {
    return new TwilioLookupVerifier(p.twilioAccountSid, p.twilioAuthToken);
  }
  if (p.numverifyApiKey) return new NumverifyVerifier(p.numverifyApiKey);
  return null;
}

/**
 * Where a number came from, which is half of what decides its label.
 *
 * Carrier lookup can tell a mobile from a landline and cannot tell a
 * company-issued cell from a private one — both are simply "mobile" to every
 * lookup API there is. Provenance supplies the missing half: a number printed
 * on a company's contact page is a work number whatever kind of line it rings,
 * and a number that arrived in a vendor's personal-data field is not.
 */
export type PhoneProvenance =
  /** Published by the company itself — a contact page, a directory. */
  | 'published'
  /** A vendor's business/work field. */
  | 'vendor_work'
  /** A vendor's mobile field. Business-adjacent, but a cell. */
  | 'vendor_mobile'
  /** A vendor's explicitly personal field. */
  | 'vendor_personal'
  /** Contributed by another organization's CRM. */
  | 'network'
  | 'unknown';

/**
 * Decide what to call this number.
 *
 * The rule errs toward 'personal' whenever provenance is unclear and the line
 * is a mobile, because the two mistakes are not symmetrical: labelling a work
 * cell "personal" costs a salesperson a moment's hesitation, while labelling
 * a private cell "work" is how somebody gets cold-called on the number they
 * give their kids' school.
 */
export function classify(provenance: PhoneProvenance, lineType: string | null): PhoneKind {
  // Published by the company for the purpose of being called. That settles it
  // regardless of what kind of line it turns out to be — plenty of small
  // contractors publish a cell as their business number, and it is one.
  if (provenance === 'published') return 'work';
  if (provenance === 'vendor_personal') return 'personal';

  if (lineType === 'landline' || lineType === 'voip' || lineType === 'tollfree') {
    // Nobody carries a desk line in their pocket.
    return 'work';
  }

  if (lineType === 'mobile') {
    if (provenance === 'vendor_work') return 'mobile';
    if (provenance === 'vendor_mobile' || provenance === 'network') return 'mobile';
    return 'personal';
  }

  // No line type — the lookup is unconfigured or had no opinion. Fall back to
  // provenance alone, and stay vague rather than inventing certainty.
  if (provenance === 'vendor_work') return 'work';
  if (provenance === 'vendor_mobile') return 'mobile';
  return 'unknown';
}

export interface RawPhone {
  number: string;
  provenance: PhoneProvenance;
  source: string;
}

/**
 * Normalise, look up, label, and de-duplicate a person's numbers.
 *
 * Runs the lookups concurrently because a reveal already waits on email
 * verification and nobody should sit through three sequential carrier calls on
 * top of it. Never throws — a number we could not check comes back labelled by
 * provenance alone with `valid: null`, which the UI renders as "not checked"
 * rather than as a working number.
 */
export async function labelPhones(raw: RawPhone[]): Promise<LabelledPhone[]> {
  const verifier = buildPhoneVerifier();

  // De-duplicate before spending anything: vendors routinely return the same
  // number in both the work and mobile fields, and paying twice to be told the
  // same thing is exactly the kind of waste this file should not create.
  const seen = new Map<string, RawPhone>();
  for (const entry of raw) {
    if (!entry.number) continue;
    const key = (toE164(entry.number) ?? entry.number).replace(/\D/g, '').slice(-10);
    if (!key) continue;
    const existing = seen.get(key);
    // A more specific provenance wins, so a number appearing as both
    // 'unknown' and 'vendor_mobile' keeps the one that says something.
    if (!existing || existing.provenance === 'unknown') seen.set(key, entry);
  }

  return Promise.all(
    [...seen.values()].map(async (entry): Promise<LabelledPhone> => {
      const e164 = toE164(entry.number);
      const base: LabelledPhone = {
        number: e164 ?? entry.number,
        kind: classify(entry.provenance, null),
        lineType: null,
        carrier: null,
        valid: null,
        verifier: null,
        source: entry.source,
      };

      // A number we could not normalise cannot be looked up either — every
      // lookup API takes E.164 — so it is returned unchecked rather than sent
      // as a string the API will reject and bill us for.
      if (!verifier || !e164) return base;

      const verdict = await verifier.check(e164);
      return {
        ...base,
        kind: classify(entry.provenance, verdict.lineType),
        lineType: verdict.lineType,
        carrier: verdict.carrier,
        valid: verdict.valid,
        verifier: verifier.name,
      };
    }),
  );
}
