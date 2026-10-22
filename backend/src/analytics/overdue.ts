/**
 * Behind on payments (Atmosphere Analytics, internal scope only): workspaces
 * that owe money, who to contact about it, and staff-written emails and texts
 * to them.
 *
 * Stripe is the source of truth for what is owed: an open invoice that has
 * already failed to charge (or is past its due date) is overdue. A workspace
 * our billing row marks past_due is listed too, even when Stripe could not be
 * read, so nobody drops off the list because of a Stripe outage.
 *
 * Contacts are billing people only: the workspace owner, global admins,
 * accountants and office managers, plus the email and phone on the Stripe
 * invoice. Homeowners and subs never owe Atmosphere and are never listed.
 * Nothing here is sent automatically; every message is written and sent by a
 * staff member and logged in overdue_account_messages.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import { normalizeSmsNumber } from '../shared/smsProvider.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const BILLING_ROLES = ['global_admin', 'accountant', 'office_manager'] as const;
const PAST_DUE_STATUSES = new Set(['past_due', 'unpaid']);
const STRIPE_INVOICE_CAP = 2_000;
export const MESSAGE_HISTORY_PER_ORG = 50;
export const MAX_RECIPIENTS = 10;
export const EMAIL_BODY_MAX = 5_000;
export const SMS_BODY_MAX = 600;

export type OverdueInvoice = {
  id: string;
  number: string | null;
  amountDueCents: number;
  currency: string;
  createdAt: string | null;
  dueAt: string | null;
  attempts: number;
  hostedInvoiceUrl: string | null;
  description: string | null;
};

export type OverdueContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** "Owner", "Global admin", "Accountant", "Office manager" or "Stripe billing". */
  role: string;
};

export type OverdueMessage = {
  id: string;
  channel: 'email' | 'sms';
  recipient: string;
  subject: string | null;
  body: string;
  status: 'sent' | 'failed' | 'logged';
  error: string | null;
  sentByEmail: string | null;
  createdAt: string;
};

export type OverdueAccount = {
  orgId: string;
  name: string;
  billingStatus: string | null;
  planCode: string | null;
  stripeCustomerId: string | null;
  mrrCents: number;
  /** Sum of overdue invoices; null when Stripe could not be read. */
  amountDueCents: number | null;
  currency: string;
  /** When the oldest overdue invoice was created (or fell due). */
  oldestDueAt: string | null;
  daysOverdue: number | null;
  invoices: OverdueInvoice[];
  contacts: OverdueContact[];
  messages: OverdueMessage[];
  lastMessageAt: string | null;
};

export type OverdueResponse = {
  generatedAt: string;
  stripeChecked: boolean;
  stripeError: string | null;
  emailReady: boolean;
  smsReady: boolean;
  accounts: OverdueAccount[];
};

function isoFromUnix(sec: number | null | undefined): string | null {
  return typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

function customerIdOf(inv: any): string | null {
  const c = inv?.customer;
  if (typeof c === 'string') return c;
  return c?.id ?? null;
}

/** Open, money still owed, and either a charge already failed or the due date passed. */
export function isOverdueInvoice(inv: any, nowMs: number): boolean {
  if (!inv || inv.status !== 'open') return false;
  if (Number(inv.amount_remaining ?? 0) <= 0) return false;
  if (Number(inv.attempt_count ?? 0) > 0) return true;
  return typeof inv.due_date === 'number' && inv.due_date * 1000 < nowMs;
}

export function invoiceRow(inv: any): OverdueInvoice {
  const line = inv?.lines?.data?.[0];
  return {
    id: String(inv.id),
    number: inv.number ?? null,
    amountDueCents: Number(inv.amount_remaining ?? 0),
    currency: String(inv.currency ?? 'usd'),
    createdAt: isoFromUnix(inv.created),
    dueAt: isoFromUnix(inv.due_date) ?? isoFromUnix(inv.created),
    attempts: Number(inv.attempt_count ?? 0),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    description: line?.description ?? inv.description ?? null,
  };
}

export function roleLabel(role: string | null | undefined, isOwner: boolean): string {
  if (isOwner) return 'Owner';
  switch (role) {
    case 'global_admin':
      return 'Global admin';
    case 'accountant':
      return 'Accountant';
    case 'office_manager':
      return 'Office manager';
    default:
      return 'Member';
  }
}

/**
 * Billing people for one workspace, owner first, de-duplicated by email and
 * phone. The Stripe invoice's own email / phone are added when nobody in the
 * workspace already has them.
 */
export function billingContacts(input: {
  ownerId: string | null;
  members: Array<{ user_id: string; role: string | null; status?: string | null }>;
  profiles: Map<string, { email: string | null; full_name: string | null }>;
  phones: Map<string, string | null>;
  stripe: Array<{ name: string | null; email: string | null; phone: string | null }>;
}): OverdueContact[] {
  const out: OverdueContact[] = [];
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  const remember = (c: OverdueContact) => {
    if (c.email) seenEmail.add(c.email.toLowerCase());
    if (c.phone) seenPhone.add(c.phone);
  };
  const people = input.members
    .filter((m) => m.status !== 'removed' && m.status !== 'disabled')
    .filter((m) => m.user_id === input.ownerId || (BILLING_ROLES as readonly string[]).includes(String(m.role)))
    .sort((a, b) => Number(b.user_id === input.ownerId) - Number(a.user_id === input.ownerId));
  for (const m of people) {
    const p = input.profiles.get(m.user_id);
    const contact: OverdueContact = {
      name: p?.full_name ?? null,
      email: p?.email?.trim() || null,
      phone: normalizeSmsNumber(input.phones.get(m.user_id) ?? '') ?? null,
      role: roleLabel(m.role, m.user_id === input.ownerId),
    };
    if (!contact.email && !contact.phone) continue;
    if (contact.email && seenEmail.has(contact.email.toLowerCase())) continue;
    out.push(contact);
    remember(contact);
  }
  for (const s of input.stripe) {
    const email = s.email?.trim() || null;
    const phone = normalizeSmsNumber(s.phone ?? '') ?? null;
    const newEmail = email && !seenEmail.has(email.toLowerCase()) ? email : null;
    const newPhone = phone && !seenPhone.has(phone) ? phone : null;
    if (!newEmail && !newPhone) continue;
    const contact: OverdueContact = { name: s.name ?? null, email: newEmail, phone: newPhone, role: 'Stripe billing' };
    out.push(contact);
    remember(contact);
  }
  return out;
}

export function daysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Pure assembly, unit-tested. */
export function assembleOverdue(input: {
  nowMs: number;
  stripeChecked: boolean;
  orgs: Array<{ id: string; name: string | null; created_by: string | null }>;
  billing: any[];
  invoices: any[];
  members: Array<{ org_id: string; user_id: string; role: string | null; status?: string | null }>;
  profiles: Map<string, { email: string | null; full_name: string | null }>;
  phones: Map<string, string | null>;
  messages: Array<{
    id: string;
    org_id: string;
    channel: 'email' | 'sms';
    recipient: string;
    subject: string | null;
    body: string;
    status: 'sent' | 'failed' | 'logged';
    error: string | null;
    sent_by_email: string | null;
    created_at: string;
  }>;
}): OverdueAccount[] {
  const orgById = new Map(input.orgs.map((o) => [o.id, o]));
  const orgByCustomer = new Map<string, string>();
  for (const b of input.billing) if (b.stripe_customer_id) orgByCustomer.set(b.stripe_customer_id, b.org_id);
  const billingByOrg = new Map(input.billing.map((b) => [b.org_id, b]));

  const invoicesByOrg = new Map<string, any[]>();
  for (const inv of input.invoices) {
    if (!isOverdueInvoice(inv, input.nowMs)) continue;
    const orgId = orgByCustomer.get(customerIdOf(inv) ?? '');
    if (!orgId) continue;
    const list = invoicesByOrg.get(orgId) ?? [];
    list.push(inv);
    invoicesByOrg.set(orgId, list);
  }

  const orgIds = new Set<string>(invoicesByOrg.keys());
  for (const b of input.billing) {
    if (PAST_DUE_STATUSES.has(String(b.status ?? '').toLowerCase())) orgIds.add(b.org_id);
  }

  const accounts: OverdueAccount[] = [];
  for (const orgId of orgIds) {
    const org = orgById.get(orgId);
    if (!org) continue;
    const b = billingByOrg.get(orgId) ?? null;
    const raw = invoicesByOrg.get(orgId) ?? [];
    const invoices = raw.map(invoiceRow).sort((x, y) => String(x.dueAt).localeCompare(String(y.dueAt)));
    const oldestDueAt = invoices[0]?.dueAt ?? null;
    const amount = invoices.reduce((n, i) => n + i.amountDueCents, 0);
    const messages = input.messages
      .filter((m) => m.org_id === orgId)
      .sort((x, y) => y.created_at.localeCompare(x.created_at))
      .slice(0, MESSAGE_HISTORY_PER_ORG)
      .map((m) => ({
        id: m.id,
        channel: m.channel,
        recipient: m.recipient,
        subject: m.subject,
        body: m.body,
        status: m.status,
        error: m.error,
        sentByEmail: m.sent_by_email,
        createdAt: m.created_at,
      }));
    accounts.push({
      orgId,
      name: org.name ?? '(unnamed workspace)',
      billingStatus: b?.status ?? null,
      planCode: b?.atmosphere_plan_code ?? b?.plan_code ?? null,
      stripeCustomerId: b?.stripe_customer_id ?? null,
      mrrCents: Number(b?.stripe_mrr_cents ?? 0),
      amountDueCents: input.stripeChecked ? amount : null,
      currency: invoices[0]?.currency ?? 'usd',
      oldestDueAt,
      daysOverdue: daysSince(oldestDueAt, input.nowMs),
      invoices,
      contacts: billingContacts({
        ownerId: org.created_by,
        members: input.members.filter((m) => m.org_id === orgId),
        profiles: input.profiles,
        phones: input.phones,
        stripe: raw.map((inv) => ({
          name: inv.customer_name ?? null,
          email: inv.customer_email ?? null,
          phone: inv.customer_phone ?? null,
        })),
      }),
      messages,
      lastMessageAt: messages[0]?.createdAt ?? null,
    });
  }
  // Most owed first, then longest overdue.
  return accounts.sort(
    (x, y) => (y.amountDueCents ?? 0) - (x.amountDueCents ?? 0) || (y.daysOverdue ?? 0) - (x.daysOverdue ?? 0) || x.name.localeCompare(y.name),
  );
}

export type StripeInvoiceLister = () => Promise<any[]>;

/** Every open invoice on the account, newest first, capped. */
export function stripeOpenInvoices(stripe: any): StripeInvoiceLister {
  return async () => {
    const out: any[] = [];
    for await (const inv of stripe.invoices.list({ status: 'open', limit: 100 })) {
      out.push(inv);
      if (out.length >= STRIPE_INVOICE_CAP) break;
    }
    return out;
  };
}

export async function loadOverdue(
  admin: SupabaseClient,
  deps: { openInvoices: StripeInvoiceLister | null; emailReady: boolean; smsReady: boolean; now?: number },
): Promise<OverdueResponse> {
  const nowMs = deps.now ?? Date.now();
  const billingRes = await admin
    .from('org_billing')
    .select('org_id, plan_code, atmosphere_plan_code, status, stripe_customer_id, stripe_mrr_cents')
    .limit(10000);
  if (billingRes.error) throw new Error(billingRes.error.message);
  const billing = billingRes.data ?? [];

  let invoices: any[] = [];
  let stripeChecked = false;
  let stripeError: string | null = null;
  if (deps.openInvoices) {
    try {
      invoices = await deps.openInvoices();
      stripeChecked = true;
    } catch (err) {
      stripeError = err instanceof Error ? err.message : 'Stripe could not be read.';
    }
  } else {
    stripeError = 'Stripe is not configured on this server.';
  }

  const customerToOrg = new Map(billing.filter((b: any) => b.stripe_customer_id).map((b: any) => [b.stripe_customer_id, b.org_id]));
  const candidate = new Set<string>();
  for (const inv of invoices) {
    const orgId = customerToOrg.get(customerIdOf(inv) ?? '');
    if (orgId && isOverdueInvoice(inv, nowMs)) candidate.add(orgId as string);
  }
  for (const b of billing) if (PAST_DUE_STATUSES.has(String(b.status ?? '').toLowerCase())) candidate.add(b.org_id);
  const orgIds = [...candidate];

  if (orgIds.length === 0) {
    return { generatedAt: new Date(nowMs).toISOString(), stripeChecked, stripeError, emailReady: deps.emailReady, smsReady: deps.smsReady, accounts: [] };
  }

  const [orgs, members, messages] = await Promise.all([
    admin.from('orgs').select('id, name, created_by').in('id', orgIds),
    admin.from('org_members').select('org_id, user_id, role, status').in('org_id', orgIds),
    admin
      .from('overdue_account_messages')
      .select('id, org_id, channel, recipient, subject, body, status, error, sent_by_email, created_at')
      .in('org_id', orgIds)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_HISTORY_PER_ORG * orgIds.length),
  ]);
  if (orgs.error) throw new Error(orgs.error.message);
  if (members.error) throw new Error(members.error.message);

  const userIds = [...new Set((members.data ?? []).map((m: any) => m.user_id as string))];
  const profilesRes = userIds.length
    ? await admin.from('profiles').select('id, email, full_name').in('id', userIds)
    : { data: [], error: null };
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const profiles = new Map((profilesRes.data ?? []).map((p: any) => [p.id, { email: p.email ?? null, full_name: p.full_name ?? null }]));

  // Sign-in phone numbers live on the auth user, not the profile.
  const phones = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        phones.set(id, data?.user?.phone || null);
      } catch {
        // A phone is a nice-to-have; the email still shows.
      }
    }),
  );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    stripeChecked,
    stripeError,
    emailReady: deps.emailReady,
    smsReady: deps.smsReady,
    accounts: assembleOverdue({
      nowMs,
      stripeChecked,
      orgs: (orgs.data ?? []) as any,
      billing,
      invoices,
      members: (members.data ?? []) as any,
      profiles,
      phones,
      // Before the migration is applied there is simply no history yet.
      messages: messages.error ? [] : ((messages.data ?? []) as any),
    }),
  };
}

export type OverdueChannel = 'email' | 'sms';

/** Why a message can't go out from this server right now, or null. */
export function overdueSendBlocker(
  channel: OverdueChannel,
  env: { SYSTEM_MAIL_DRIVER?: string },
  isProduction: boolean,
  ready: { emailReady: boolean; smsReady: boolean },
): { code: string; message: string } | null {
  if (channel === 'email') {
    if (!ready.emailReady) return { code: 'email_unconfigured', message: 'Email is not set up on this server.' };
    if (!isProduction && (env.SYSTEM_MAIL_DRIVER ?? '').trim().toLowerCase() !== 'log') {
      return {
        code: 'overdue_dev_guard',
        message: 'Outside production, emails only go to the local mail log (set SYSTEM_MAIL_DRIVER=log).',
      };
    }
    return null;
  }
  if (!isProduction) return { code: 'overdue_dev_guard', message: 'Texts are only sent from production.' };
  if (!ready.smsReady) {
    return {
      code: 'sms_unconfigured',
      message: 'Texting is not set up. Add the Twilio settings (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID) on the API.',
    };
  }
  return null;
}

/**
 * Only addresses already listed for this workspace can be messaged, so the
 * page can't be used to email or text anyone else.
 */
export function allowedRecipients(account: OverdueAccount, channel: OverdueChannel, requested: string[]): string[] {
  const allowed = new Map<string, string>();
  for (const c of account.contacts) {
    if (channel === 'email' && c.email) allowed.set(c.email.toLowerCase(), c.email);
    if (channel === 'sms' && c.phone) allowed.set(c.phone, c.phone);
  }
  const out: string[] = [];
  for (const raw of requested) {
    const key = channel === 'email' ? raw.trim().toLowerCase() : normalizeSmsNumber(raw) ?? '';
    const match = allowed.get(key);
    if (!match) throw new HttpError(400, `${raw} is not a billing contact for ${account.name}.`, 'recipient_not_allowed');
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

export type OverdueSendResult = { recipient: string; status: 'sent' | 'failed' | 'logged'; error: string | null };

export async function sendOverdueMessage(
  deps: {
    admin: SupabaseClient;
    account: OverdueAccount;
    logOnly: boolean;
    sendEmail: (input: { to: string; subject: string; text: string }) => Promise<{ ok: true } | { ok: false; why: string }>;
    sendText: (input: { to: string; body: string; orgId: string }) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
    sender: { userId: string | null; email: string | null };
  },
  input: { channel: OverdueChannel; recipients: string[]; subject: string | null; body: string },
): Promise<OverdueSendResult[]> {
  const body = input.body.trim();
  const subject = input.subject?.trim() || null;
  if (!body) throw new HttpError(400, 'Write a message first.', 'message_empty');
  if (input.channel === 'email' && !subject) throw new HttpError(400, 'Add a subject.', 'subject_empty');
  if (input.channel === 'sms' && body.length > SMS_BODY_MAX) {
    throw new HttpError(400, `Texts can be at most ${SMS_BODY_MAX} characters.`, 'message_too_long');
  }
  const recipients = allowedRecipients(deps.account, input.channel, input.recipients);
  if (recipients.length === 0) throw new HttpError(400, 'Pick at least one person.', 'no_recipients');

  const results: OverdueSendResult[] = [];
  for (const to of recipients) {
    let result: OverdueSendResult;
    let providerId: string | null = null;
    if (input.channel === 'email') {
      const sent = await deps.sendEmail({ to, subject: subject!, text: body });
      result = sent.ok
        ? { recipient: to, status: deps.logOnly ? 'logged' : 'sent', error: null }
        : { recipient: to, status: 'failed', error: sent.why };
    } else {
      const sent = await deps.sendText({ to, body, orgId: deps.account.orgId });
      if (sent.ok) providerId = sent.id;
      result = sent.ok ? { recipient: to, status: 'sent', error: null } : { recipient: to, status: 'failed', error: sent.message };
    }
    results.push(result);
    const { error } = await deps.admin.from('overdue_account_messages').insert({
      org_id: deps.account.orgId,
      channel: input.channel,
      recipient: to,
      subject: input.channel === 'email' ? subject : null,
      body,
      status: result.status,
      error: result.error?.slice(0, 1000) ?? null,
      provider_id: providerId,
      amount_due_cents: deps.account.amountDueCents,
      sent_by: deps.sender.userId,
      sent_by_email: deps.sender.email,
    });
    if (error) console.warn('[overdue] could not record message', error.message);
  }
  return results;
}
