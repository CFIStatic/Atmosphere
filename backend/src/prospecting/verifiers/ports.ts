/**
 * The mailbox-verification port.
 *
 * Verification is the whole product. A vendor match, a pattern guess and a
 * hand-typed address are all just strings until something proves a mail server
 * will accept them, and selling an unverified string is how a customer's
 * sending domain ends up on a blocklist.
 *
 * There are two ways to get that proof and they are not interchangeable:
 *
 *   SMTP   — talk to the recipient's mail exchanger yourself (RCPT TO, then
 *            QUIT). Free, no vendor, and completely accurate when it works.
 *            It requires outbound port 25, which AWS, GCP, Azure and most PaaS
 *            hosts block by default and will not open without a support case.
 *            It also puts your IP's reputation on the line every time.
 *
 *   Vendor — ZeroBounce, NeverBounce and friends run that same conversation
 *            from mail infrastructure they own and warm, and answer over
 *            plain HTTPS. Costs about half a cent. Works from anywhere.
 *
 * So the mailbox question sits behind this interface and the ladder in
 * verification.ts does not care which answered. Everything cheap and local —
 * syntax, role addresses, free-mail domains, MX lookup — happens before any
 * implementation of this is consulted, so a vendor is never billed for a
 * question DNS already settled.
 */

/**
 * What a verifier can say about one address.
 *
 * `exists` is deliberately three-valued and `null` is not a rejection. A
 * greylisting server, a rate limit and a timeout all mean "no opinion", and
 * reporting those as "invalid" would have the product deleting real people
 * from a customer's list.
 */
export interface MailboxVerdict {
  /** True = the mailbox exists. False = rejected. Null = no opinion. */
  exists: boolean | null;
  /**
   * True when the domain accepts every address, so no per-address answer is
   * possible from it. Null when the verifier did not test for it.
   */
  catchAll: boolean | null;
  /** True for throwaway inbox services — real today, gone next week. */
  disposable?: boolean;
  /** The verifier's own words, when it offers any. Safe to log, not to show. */
  detail?: string;
}

export interface MailboxVerifier {
  /** 'SMTP', 'ZeroBounce', 'NeverBounce' — shown in the audit trail. */
  readonly name: string;
  /**
   * True when this verifier costs money per check, so the caller can decide
   * whether a question is worth asking. Pattern inference walks up to five
   * candidates per person; at half a cent each that is worth knowing about.
   */
  readonly metered: boolean;
  /** Cheap credential check for the settings screen. Throws when unusable. */
  verify(): Promise<void>;
  /**
   * Does this mailbox exist? Must never throw — an unreachable verifier is
   * `exists: null`, which is a legitimate answer the ladder prices as
   * 'unknown'.
   */
  check(email: string, domain: string): Promise<MailboxVerdict>;
}
