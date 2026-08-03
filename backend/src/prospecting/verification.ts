import { buildMailboxVerifier, lowestMx } from './verifiers/index.js';

/**
 * Email verification — the difference between a guess and an address.
 *
 * Every contact-data product lives or dies on this. A vendor match, a pattern
 * guess and a hand-typed address are all just strings until something proves a
 * mail server will accept them, and selling an unverified string is how a
 * customer's domain reputation gets burned sending to dead mailboxes.
 *
 * The ladder, cheapest first, stopping as soon as the answer is known:
 *
 *   1. Syntax        — malformed, or a free-mail/role address we won't sell.
 *   2. MX records    — does the domain accept mail at all?
 *   3. Mailbox       — does this specific address exist? Delegated to whatever
 *                      verifier is configured: our own SMTP probe where port
 *                      25 is open, or ZeroBounce/NeverBounce over HTTPS where
 *                      it is not. That choice lives in verifiers/index.ts and
 *                      nothing here depends on which one answered.
 *
 * Steps 1 and 2 run first and locally on purpose. They settle a large share of
 * bad addresses for the price of a DNS lookup, so a metered verifier is never
 * billed for a question we could answer ourselves.
 *
 * A verdict is deliberately three-valued. 'risky' is not a failure — it is the
 * honest answer for a catch-all domain, and the UI says so rather than
 * pretending to a confidence nobody has.
 */

export type EmailVerdict = 'valid' | 'risky' | 'invalid' | 'unknown';

export interface VerificationResult {
  email: string;
  verdict: EmailVerdict;
  /** 0–1. What we would bet on this address landing. */
  score: number;
  /** Short, human, and safe to show a customer. */
  reason: string;
  /** True when the domain accepts everything, so no address can be confirmed. */
  catchAll: boolean;
  /** True when the domain has no mail exchanger at all. */
  noMx: boolean;
  /**
   * Which verifier answered — 'SMTP', 'ZeroBounce', … — or null when nothing
   * confirmed the mailbox. The customer is entitled to know the difference
   * between "a mail server accepted this" and "nobody checked".
   */
  verifier: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Addresses that are real but useless to sell: shared mailboxes nobody owns,
 * and consumer domains where a business contact does not belong.
 */
const ROLE_LOCALS = new Set([
  'info', 'sales', 'support', 'admin', 'office', 'contact', 'hello', 'help',
  'billing', 'accounts', 'noreply', 'no-reply', 'postmaster', 'webmaster',
  'abuse', 'marketing', 'jobs', 'careers', 'team',
]);

/**
 * Consumer mail providers. An address here belongs to a person rather than to
 * a job, and this product does not sell it.
 *
 * The list has to be broad, because a short one fails silently in the worst
 * direction: `ymail.com` and `rocketmail.com` are Yahoo's own alternate
 * domains, and while they were missing, somebody's private mailbox was being
 * treated as a business address by every layer downstream. The cost of a
 * missing entry is a person's personal address getting sold; the cost of an
 * extra entry is one business contact we decline to sell. Those are not
 * remotely equivalent, so this errs long.
 */
const FREE_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Yahoo, including the alternates people forget
  'yahoo.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au', 'yahoo.fr', 'yahoo.de',
  'ymail.com', 'rocketmail.com',
  // Microsoft
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Privacy-focused
  'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
  'hushmail.com',
  // Everyone else in common use
  'aol.com', 'aim.com', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com',
  'zoho.com', 'yandex.com', 'yandex.ru', 'fastmail.com', 'fastmail.fm',
  'inbox.com', 'mail.ru', 'qq.com', '163.com', '126.com', 'naver.com',
  'daum.net', 'seznam.cz', 'web.de', 't-online.de', 'orange.fr', 'wanadoo.fr',
  'free.fr', 'libero.it', 'virgilio.it', 'terra.com.br', 'uol.com.br',
  'bol.com.br', 'rediffmail.com', 'sina.com', 'comcast.net', 'verizon.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
  'earthlink.net', 'juno.com', 'btinternet.com', 'sky.com', 'talktalk.net',
  'shaw.ca', 'rogers.com', 'telus.net', 'bigpond.com', 'optusnet.com.au',
]);

/**
 * Throwaway inbox services. Real for an hour, gone by the time anyone writes,
 * and a strong signal that whoever used it did not want to be contacted.
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com',
  'temp-mail.org', 'tempmail.com', 'throwawaymail.com', 'yopmail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'maildrop.cc',
  'dispostable.com', 'fakeinbox.com', 'mintemail.com', 'spamgourmet.com',
  'mailnesia.com', 'tempinbox.com', 'moakt.com', 'emailondeck.com',
]);

export function isDisposableDomain(email: string): boolean {
  const parts = splitEmail(email);
  return parts ? DISPOSABLE_DOMAINS.has(parts.domain) : false;
}

export function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  return { local: email.slice(0, at).toLowerCase(), domain: email.slice(at + 1).toLowerCase() };
}

export function isRoleAddress(email: string): boolean {
  const parts = splitEmail(email);
  return parts ? ROLE_LOCALS.has(parts.local) : false;
}

export function isFreeDomain(email: string): boolean {
  const parts = splitEmail(email);
  return parts ? FREE_DOMAINS.has(parts.domain) : false;
}

export interface VerifyOptions {
  /** Skip the mailbox check — DNS-only, for free bulk pre-filtering. */
  dnsOnly?: boolean;
}

/**
 * Verify one address. Never throws: an unreachable server is 'unknown', which
 * is a legitimate answer, and callers price it accordingly.
 */
export async function verifyEmail(
  email: string,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  const address = email.trim().toLowerCase();
  // Everything below step 3 is answered locally, so nothing confirmed a
  // mailbox and `verifier` stays null; the delegated branches set their own.
  const base = { email: address, catchAll: false, noMx: false, verifier: null };

  if (!EMAIL_RE.test(address)) {
    return { ...base, verdict: 'invalid', score: 0, reason: 'Not a valid address.' };
  }

  const parts = splitEmail(address);
  if (!parts) {
    return { ...base, verdict: 'invalid', score: 0, reason: 'Not a valid address.' };
  }

  if (FREE_DOMAINS.has(parts.domain)) {
    // Deliverable, and deliberately not sold. A consumer mailbox belongs to a
    // person rather than to a job: it is the address someone gives their
    // family, and it is not what they published to be contacted about work.
    // 'risky' without catchAll can never pass sellable(), so this is a refusal
    // rather than a warning.
    return {
      ...base,
      verdict: 'risky',
      score: 0.4,
      reason: 'Personal mailbox, not a company address.',
    };
  }

  if (DISPOSABLE_DOMAINS.has(parts.domain)) {
    return {
      ...base,
      verdict: 'invalid',
      score: 0,
      reason: 'A throwaway inbox — whoever used it did not want to be contacted.',
    };
  }

  const mx = await lowestMx(parts.domain);
  if (!mx) {
    return {
      ...base,
      noMx: true,
      verdict: 'invalid',
      score: 0,
      reason: 'That domain does not accept email.',
    };
  }

  const verifier = options.dnsOnly ? null : buildMailboxVerifier();
  if (!verifier) {
    return {
      ...base,
      verdict: 'unknown',
      score: 0.5,
      reason: 'The domain accepts mail; the mailbox itself was not confirmed.',
      verifier: null,
    };
  }

  const result = await verifier.check(address, parts.domain);

  if (result.catchAll === true) {
    return {
      ...base,
      catchAll: true,
      verdict: 'risky',
      score: 0.55,
      reason: 'The domain accepts all mail, so the mailbox cannot be confirmed.',
      verifier: verifier.name,
    };
  }

  if (result.disposable) {
    return {
      ...base,
      verdict: 'invalid',
      score: 0.05,
      reason: 'A disposable inbox — real today, gone next week.',
      verifier: verifier.name,
    };
  }

  if (result.exists === true) {
    const role = ROLE_LOCALS.has(parts.local);
    return {
      ...base,
      verdict: role ? 'risky' : 'valid',
      score: role ? 0.6 : 0.92,
      reason: role
        ? 'A shared mailbox — real, but nobody in particular reads it.'
        : 'The mail server accepted this mailbox.',
      verifier: verifier.name,
    };
  }

  if (result.exists === false) {
    return {
      ...base,
      verdict: 'invalid',
      score: 0.05,
      reason: 'The mail server rejected this mailbox.',
      verifier: verifier.name,
    };
  }

  return {
    ...base,
    verdict: 'unknown',
    score: 0.5,
    reason: 'The mail server would not confirm either way.',
    verifier: verifier.name,
  };
}
