/**
 * The phone-verification port.
 *
 * Email had a four-step ladder ending in a mail server confirming the mailbox.
 * Phone numbers had nothing at all — whatever the vendor said was what the
 * customer got, and a salesperson found out it was wrong by dialling it.
 *
 * Carrier lookup is the equivalent authority. It answers two things no data
 * vendor reliably does:
 *
 *   Is this number actually assigned?  A disconnected line looks exactly like
 *                                      a working one in a database.
 *   What kind of line is it?           Landline, mobile, or VoIP — which is
 *                                      what makes "a direct office line" and
 *                                      "somebody's personal cell" different
 *                                      things rather than both being 'phone'.
 *
 * That second answer is the phone counterpart of FREE_DOMAINS. A gmail belongs
 * to a person rather than to a job, and so does a personal mobile; the product
 * should be able to tell the customer which one they are about to dial.
 *
 * One honest limit, stated here because the label depends on it: carrier data
 * cannot distinguish a company-issued cell from a private one. Both are
 * "mobile" to every lookup API in existence. What separates them is where the
 * number came from — a number published on a company's contact page is a work
 * number; one that arrived in a vendor's personal-data field is not — so
 * provenance does that work, and the labelling stays conservative when
 * provenance is unclear.
 */

/** What kind of number this is, from the point of view of somebody dialling. */
export type PhoneKind =
  /** A desk line, switchboard, or direct dial at the company. */
  | 'work'
  /** A mobile the person uses for work — reachable, and expected to be. */
  | 'mobile'
  /** A private cell. Real, and not published to be called about business. */
  | 'personal'
  /** Nothing established which of the above it is. */
  | 'unknown';

/** The carrier's own classification, untranslated. */
export type LineType = 'landline' | 'mobile' | 'voip' | 'tollfree' | 'other' | null;

export interface PhoneVerdict {
  /** True when the number is assigned, false when it is not, null for no opinion. */
  valid: boolean | null;
  lineType: LineType;
  /** e.g. 'Verizon Wireless'. Null when the lookup does not say. */
  carrier: string | null;
  /** Two-letter country, where the lookup reports one. */
  country: string | null;
  detail?: string;
}

export interface PhoneVerifier {
  /** 'Twilio Lookup', 'NumVerify' — shown in the audit trail. */
  readonly name: string;
  /** True when a lookup costs money per number. */
  readonly metered: boolean;
  /** Cheap credential check for the settings screen. Throws when unusable. */
  verify(): Promise<void>;
  /**
   * Look one number up. Must never throw: an unreachable verifier is
   * `valid: null`, which the caller renders as "not checked" rather than as
   * "does not work".
   */
  check(e164: string): Promise<PhoneVerdict>;
}

/**
 * One number as the product hands it to a customer.
 *
 * Every field is here so the UI can be specific instead of printing a bare
 * string: which number this is, whether anybody confirmed it, and who said so.
 */
export interface LabelledPhone {
  /** E.164 when we could normalise it, otherwise exactly as the source gave it. */
  number: string;
  kind: PhoneKind;
  lineType: LineType;
  carrier: string | null;
  /** Null when no lookup ran — never conflate "unchecked" with "invalid". */
  valid: boolean | null;
  /** Which verifier answered, or null when none did. */
  verifier: string | null;
  /** Where the number came from, for the audit trail. */
  source: string;
}
