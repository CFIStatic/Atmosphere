import { isDisposableDomain, isFreeDomain, isRoleAddress } from '../../prospecting/verification.js';

/**
 * The gate every campaign message passes through.
 *
 * This exists as one function on purpose. A weather-triggered campaign sends
 * while nobody is watching, to people who never asked to hear from us, from a
 * mailbox belonging to a customer whose domain reputation is their livelihood.
 * The controls that make that acceptable cannot live in whichever code path
 * happened to call send() — they have to be somewhere it is impossible to
 * route around.
 *
 * So: senders in mail/*.ts know how to put bytes on the wire and nothing else.
 * Every decision about whether a message *should* go is made here.
 *
 * CAN-SPAM is the floor, not the ceiling. It requires accurate headers, a
 * physical postal address, a working unsubscribe, and that opt-outs are
 * honoured within ten business days. We honour them immediately, because the
 * ten days is a legal maximum and treating it as a target is how a company
 * ends up defending itself for something it did not need to do.
 */

export interface SendPolicy {
  /** The org's postal address. Required in every commercial message. */
  postalAddress: string;
  /** Where an unsubscribe click lands. */
  unsubscribeUrl: string;
  /** Per-campaign ceiling, so one bad rule cannot mail a whole database. */
  maxRecipients: number;
  /** Per-day ceiling for the connected mailbox. */
  dailyCeiling: number;
}

export interface Recipient {
  email: string;
  name?: string | null;
  company?: string | null;
}

export type BlockReason =
  | 'suppressed'
  | 'erased'
  | 'unsubscribed'
  | 'already_sent'
  | 'role_address'
  | 'personal_address'
  | 'disposable'
  | 'invalid'
  | 'bounced_before'
  | 'over_campaign_cap'
  | 'over_daily_cap';

export interface Screened {
  send: Recipient[];
  blocked: Array<{ email: string; reason: BlockReason }>;
}

export interface ScreenInput {
  recipients: Recipient[];
  /** Lowercased. The org's own do-not-contact list. */
  suppressedEmails: Set<string>;
  suppressedDomains: Set<string>;
  /** Global erasure tombstones — outrank everything, across all orgs. */
  erasedEmails: Set<string>;
  /** Anyone who has ever clicked unsubscribe on anything from this org. */
  unsubscribed: Set<string>;
  /** Already sent this campaign-fire. Re-running must not re-send. */
  alreadySent: Set<string>;
  /** Hard-bounced before. Sending again is how a sender gets blocklisted. */
  hardBounced: Set<string>;
  policy: SendPolicy;
  /** How many this mailbox has already sent today. */
  sentToday: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Decide who actually gets this message.
 *
 * Returns both lists. The blocked one with its reasons is not diagnostics — it
 * is the record that answers "why didn't Marcia get this?" and "prove you
 * honoured the unsubscribe", and both of those questions get asked.
 *
 * Order matters. Erasure is checked before anything else because it is the
 * strongest claim anybody can make on their own data, and a bug in a later
 * check must not be able to let it through.
 */
export function screenRecipients(input: ScreenInput): Screened {
  const send: Recipient[] = [];
  const blocked: Array<{ email: string; reason: BlockReason }> = [];
  const seen = new Set<string>();

  const dailyRemaining = input.policy.dailyCeiling - input.sentToday;
  let budget = Math.max(0, Math.min(input.policy.maxRecipients, dailyRemaining));

  // Which limit actually bound, decided once. Reporting "over campaign cap"
  // to somebody who has really exhausted their mailbox's daily allowance
  // sends them to change the wrong setting, and they hit the same wall again.
  const capReason: BlockReason =
    dailyRemaining <= input.policy.maxRecipients ? 'over_daily_cap' : 'over_campaign_cap';

  for (const recipient of input.recipients) {
    const email = (recipient.email ?? '').trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email)) {
      blocked.push({ email, reason: 'invalid' });
      continue;
    }
    // One message per person per run, whatever the audience rules produced.
    // A contact who is also a place, or in two categories, is still one human.
    if (seen.has(email)) continue;
    seen.add(email);

    // Erasure first. Nothing below may override it.
    if (input.erasedEmails.has(email)) {
      blocked.push({ email, reason: 'erased' });
      continue;
    }
    if (input.unsubscribed.has(email)) {
      blocked.push({ email, reason: 'unsubscribed' });
      continue;
    }
    if (input.suppressedEmails.has(email)) {
      blocked.push({ email, reason: 'suppressed' });
      continue;
    }

    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (input.suppressedDomains.has(domain)) {
      blocked.push({ email, reason: 'suppressed' });
      continue;
    }

    if (input.hardBounced.has(email)) {
      blocked.push({ email, reason: 'bounced_before' });
      continue;
    }
    if (input.alreadySent.has(email)) {
      blocked.push({ email, reason: 'already_sent' });
      continue;
    }

    // A shared mailbox is not a person, and "Hi there" to info@ is the message
    // that makes a whole domain mark the sender as spam.
    if (isRoleAddress(email)) {
      blocked.push({ email, reason: 'role_address' });
      continue;
    }
    // A personal address is not a business contact. The product refuses to
    // sell them and it refuses to mail them.
    if (isFreeDomain(email)) {
      blocked.push({ email, reason: 'personal_address' });
      continue;
    }
    if (isDisposableDomain(email)) {
      blocked.push({ email, reason: 'disposable' });
      continue;
    }

    if (budget <= 0) {
      blocked.push({ email, reason: capReason });
      continue;
    }

    budget -= 1;
    send.push({ ...recipient, email });
  }

  return { send, blocked };
}

/**
 * Attach what the law requires, and what a decent sender would include anyway.
 *
 * Appended here rather than left to the template because a template is edited
 * by a salesperson at 5pm and a missing unsubscribe link is a CAN-SPAM
 * violation, not a typo. The body arrives complete or it does not send.
 *
 * Plain text throughout. An HTML campaign to a facilities director reads as
 * marketing, and the entire premise is that this reads as a person typing —
 * which also happens to be what lands in an inbox rather than a promotions tab.
 */
export function finaliseBody(body: string, policy: SendPolicy, token: string): string {
  const trimmed = body.trimEnd();
  const unsubscribe = `${policy.unsubscribeUrl}${policy.unsubscribeUrl.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;

  return [
    trimmed,
    '',
    '',
    '—',
    policy.postalAddress,
    `Don't want these? Unsubscribe: ${unsubscribe}`,
  ].join('\n');
}

/**
 * Refuse to start a send at all when the policy is incomplete.
 *
 * Checked before the first message rather than per-recipient: a campaign that
 * sent four hundred messages and then discovered it had no postal address
 * would already have committed the violation four hundred times.
 */
export function validatePolicy(policy: Partial<SendPolicy>): string[] {
  const problems: string[] = [];
  if (!policy.postalAddress?.trim()) {
    problems.push('A postal address is required in every commercial email. Add yours in Settings.');
  }
  if (!policy.unsubscribeUrl?.trim()) {
    problems.push('An unsubscribe link is required in every commercial email.');
  }
  if (!policy.maxRecipients || policy.maxRecipients < 1) {
    problems.push('Set a maximum number of recipients for a single send.');
  }
  return problems;
}

/**
 * A message that survives being read aloud in a complaint.
 *
 * Subject lines that misrepresent the message are the specific thing CAN-SPAM
 * prohibits, and they are also what gets a sender filtered. This catches the
 * obvious offenders rather than pretending to judge tone.
 */
export function subjectProblems(subject: string): string[] {
  const problems: string[] = [];
  const s = subject.trim();
  if (!s) problems.push('The subject is empty.');
  if (s.length > 120) problems.push('The subject is very long and will be truncated.');
  if (/^re:|^fwd:/i.test(s)) {
    // Faking a reply to a conversation that never happened is deceptive, and
    // it is the single fastest way to be reported.
    problems.push('Starting with "Re:" or "Fwd:" on a first contact is deceptive — and reported.');
  }
  if (/\b(free|guarantee|act now|urgent|winner|risk[- ]free)\b/i.test(s)) {
    problems.push('That wording reads as marketing and will be filtered.');
  }
  if (s === s.toUpperCase() && s.length > 12) problems.push('All capitals reads as spam.');
  return problems;
}
