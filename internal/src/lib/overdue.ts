import { money } from './format';

export interface OverdueInvoice {
  id: string;
  number: string | null;
  amountDueCents: number;
  currency: string;
  createdAt: string | null;
  dueAt: string | null;
  attempts: number;
  hostedInvoiceUrl: string | null;
  description: string | null;
}

export interface OverdueContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
}

export type OverdueChannel = 'email' | 'sms';

export interface OverdueMessage {
  id: string;
  channel: OverdueChannel;
  recipient: string;
  subject: string | null;
  body: string;
  status: 'sent' | 'failed' | 'logged';
  error: string | null;
  sentByEmail: string | null;
  createdAt: string;
}

export interface OverdueAccount {
  orgId: string;
  name: string;
  billingStatus: string | null;
  planCode: string | null;
  stripeCustomerId: string | null;
  mrrCents: number;
  amountDueCents: number | null;
  currency: string;
  oldestDueAt: string | null;
  daysOverdue: number | null;
  invoices: OverdueInvoice[];
  contacts: OverdueContact[];
  messages: OverdueMessage[];
  lastMessageAt: string | null;
}

export interface OverdueResponse {
  generatedAt: string;
  stripeChecked: boolean;
  stripeError: string | null;
  emailReady: boolean;
  smsReady: boolean;
  accounts: OverdueAccount[];
}

export interface OverdueSendResult {
  recipient: string;
  status: 'sent' | 'failed' | 'logged';
  error: string | null;
}

export const SMS_BODY_MAX = 600;

export type TemplateKey = 'reminder' | 'follow_up' | 'final';

export const TEMPLATES: Array<[TemplateKey, string]> = [
  ['reminder', 'Friendly reminder'],
  ['follow_up', 'Follow-up'],
  ['final', 'Final notice'],
];

/** The Stripe page where they can pay: the oldest invoice that has one. */
export function payLink(account: OverdueAccount): string | null {
  return account.invoices.find((i) => i.hostedInvoiceUrl)?.hostedInvoiceUrl ?? null;
}

function amountPhrase(account: OverdueAccount): string {
  return account.amountDueCents && account.amountDueCents > 0 ? money(account.amountDueCents) : 'your balance';
}

function firstName(contact: OverdueContact | undefined): string {
  const name = contact?.name?.trim();
  return name ? name.split(/\s+/)[0]! : 'there';
}

/**
 * Starting text for a message. Staff always read and edit it before sending;
 * nothing is sent from a template on its own.
 */
export function templateText(
  key: TemplateKey,
  channel: OverdueChannel,
  account: OverdueAccount,
  to?: OverdueContact,
): { subject: string; body: string } {
  const amount = amountPhrase(account);
  const link = payLink(account);
  const payLine = link ? `You can pay here: ${link}` : 'You can update your card in Atmosphere under Settings > Billing.';
  if (channel === 'sms') {
    const text: Record<TemplateKey, string> = {
      reminder: `Atmosphere: the payment for ${account.name} (${amount}) didn't go through. ${payLine}`,
      follow_up: `Atmosphere: ${account.name} still has ${amount} past due. ${payLine} Reply or email hello@atmosphereteam.com with questions.`,
      final: `Atmosphere: final notice for ${account.name}. ${amount} is past due and the account will be paused if it isn't paid. ${payLine}`,
    };
    return { subject: '', body: text[key] };
  }
  const hi = `Hi ${firstName(to)},`;
  const sign = '\n\nThanks,\nThe Atmosphere team';
  switch (key) {
    case 'reminder':
      return {
        subject: `Your Atmosphere payment didn't go through`,
        body: `${hi}\n\nThe latest payment for ${account.name} didn't go through, so ${amount} is now past due. This usually means the card on file expired or was declined.\n\n${payLine}\n\nIf you have any questions, just reply to this email.${sign}`,
      };
    case 'follow_up':
      return {
        subject: `${account.name}: ${amount} past due`,
        body: `${hi}\n\nFollowing up on the past-due balance of ${amount} for ${account.name}. Please take care of it when you can so your team's access isn't interrupted.\n\n${payLine}\n\nIf something is wrong with the bill, reply and we'll sort it out.${sign}`,
      };
    case 'final':
      return {
        subject: `Final notice: ${account.name} account will be paused`,
        body: `${hi}\n\n${account.name} has a past-due balance of ${amount}. If it isn't paid, we'll pause the account. Your jobs and files are kept and nothing is deleted, but your team won't be able to use Atmosphere until the balance is paid.\n\n${payLine}\n\nIf you think this is a mistake or need a payment plan, reply to this email.${sign}`,
      };
  }
}

export function contactsFor(account: OverdueAccount, channel: OverdueChannel): OverdueContact[] {
  return account.contacts.filter((c) => (channel === 'email' ? c.email : c.phone));
}

export function addressOf(contact: OverdueContact, channel: OverdueChannel): string {
  return (channel === 'email' ? contact.email : contact.phone) ?? '';
}

/** "+16085551234" → "(608) 555-1234"; anything else is left as is. */
export function phoneLabel(phone: string | null): string {
  if (!phone) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

export function overdueTotals(accounts: OverdueAccount[]): { accounts: number; owedCents: number; over30: number } {
  return {
    accounts: accounts.length,
    owedCents: accounts.reduce((n, a) => n + (a.amountDueCents ?? 0), 0),
    over30: accounts.filter((a) => (a.daysOverdue ?? 0) >= 30).length,
  };
}

export function daysLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Today';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
