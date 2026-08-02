/**
 * The contact-data port.
 *
 * Finding a property manager's mobile number is a licensed-data problem, not
 * an algorithmic one: the records belong to vendors (People Data Labs, Apollo,
 * Prospeo, ZoomInfo) who sell matches by the API call. Everything above this
 * file is ours — the search UI, the credit charge, the dedupe against the CRM,
 * the suppression list, the audit trail. Everything below it is bought.
 *
 * So the vendor sits behind one narrow interface with two halves, because
 * that split is what the business model rests on:
 *
 *   search()  — cheap or free at most vendors. Returns people WITHOUT contact
 *               details. This is what fills the results table.
 *   reveal()  — the metered call. Returns the email and phone for one person,
 *               and is the only method that costs money.
 *
 * Keeping them apart is deliberate: it lets a customer browse a whole
 * territory for nothing and pay only for the people they actually want, which
 * is both the fair arrangement and the one that makes the credit charge easy
 * to explain on an invoice.
 */

/** What a search knows about someone before anybody has paid for them. */
export interface ProspectMatch {
  /** The vendor's key for this person. Stable enough to re-request by. */
  providerPersonId: string;
  fullName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  location: string | null;
  linkedinUrl: string | null;
  /** 0–1. How sure the vendor is that this is one real person. */
  confidence: number | null;
  /**
   * Whether the vendor claims to hold contact details for them. A reveal on a
   * match with none of these is a wasted credit, so the UI greys it out and
   * the route refuses to charge for it.
   */
  hasEmail: boolean;
  hasPhone: boolean;
}

/** What a reveal returns. The part that costs money. */
export interface RevealedContact {
  providerPersonId: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  /** 0–1 confidence in the contact details specifically, not the identity. */
  confidence: number | null;
  /**
   * What the vendor charged us, in nanodollars. Recorded against the usage
   * event so margin on a reveal is as visible as margin on a model call.
   * Zero when the vendor bills by subscription rather than by match.
   */
  costNanos: number;
}

/** Where to look. Deliberately the fields a restoration company thinks in. */
export interface ProspectQuery {
  /** Free text: a company, a person, "property manager", anything. */
  q?: string;
  /** City, metro, or region — the territory being worked. */
  location?: string;
  /** Job titles to match, e.g. ['property manager', 'facilities director']. */
  titles?: string[];
  /** Restrict to one company's people by domain. */
  companyDomain?: string;
  /** Industry, in the vendor's vocabulary where one is supplied. */
  industry?: string;
  limit?: number;
}

export interface ProspectSearchResult {
  matches: ProspectMatch[];
  /** Total the vendor claims to hold, when it says. */
  total: number | null;
}

/**
 * One vendor. Implementations normalise their own payloads into the shapes
 * above so nothing upstream of here ever learns which vendor answered.
 */
export interface ContactDataProvider {
  /** 'Sandbox', 'People Data Labs', … — shown in the UI and the audit trail. */
  readonly name: string;
  /** True when the data is synthetic. The UI must say so, plainly. */
  readonly sandbox: boolean;
  /** Cheap credential check for the settings screen. Throws when unusable. */
  verify(): Promise<void>;
  search(query: ProspectQuery): Promise<ProspectSearchResult>;
  /** Null when the vendor turns out to hold nothing — the caller must not charge. */
  reveal(providerPersonId: string): Promise<RevealedContact | null>;
}

/** Raised when a vendor call fails in a way worth telling the customer about. */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'provider_error') {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
  }
}
