import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedRecipients,
  assembleOverdue,
  billingContacts,
  isOverdueInvoice,
  overdueSendBlocker,
  sendOverdueMessage,
  type OverdueAccount,
} from '../src/analytics/overdue.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const DAY = 86_400;
const nowSec = NOW / 1000;

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    status: 'open',
    customer: 'cus_A',
    amount_remaining: 29900,
    attempt_count: 2,
    created: nowSec - 10 * DAY,
    due_date: null,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
    customer_email: 'billing@ridge.example',
    customer_phone: '608-555-0100',
    customer_name: 'Ridge Roofing',
    lines: { data: [{ description: 'Atmosphere Pro' }] },
    ...over,
  };
}

test('an invoice is overdue only when open, owed and already failed or past due', () => {
  assert.equal(isOverdueInvoice(invoice(), NOW), true);
  assert.equal(isOverdueInvoice(invoice({ status: 'paid' }), NOW), false);
  assert.equal(isOverdueInvoice(invoice({ amount_remaining: 0 }), NOW), false);
  // Just finalized, not attempted yet, no due date: not overdue.
  assert.equal(isOverdueInvoice(invoice({ attempt_count: 0 }), NOW), false);
  assert.equal(isOverdueInvoice(invoice({ attempt_count: 0, due_date: nowSec - DAY }), NOW), true);
  assert.equal(isOverdueInvoice(invoice({ attempt_count: 0, due_date: nowSec + DAY }), NOW), false);
});

test('billing contacts are the owner and billing roles, owner first, plus new Stripe details', () => {
  const contacts = billingContacts({
    ownerId: 'u1',
    members: [
      { user_id: 'u3', role: 'field_technician' },
      { user_id: 'u2', role: 'accountant' },
      { user_id: 'u1', role: 'global_admin' },
      { user_id: 'u4', role: 'global_admin', status: 'removed' },
    ],
    profiles: new Map([
      ['u1', { email: 'owner@ridge.example', full_name: 'Avery Ridge' }],
      ['u2', { email: 'books@ridge.example', full_name: 'Blake Books' }],
      ['u3', { email: 'tech@ridge.example', full_name: 'Tech' }],
      ['u4', { email: 'gone@ridge.example', full_name: 'Gone' }],
    ]),
    phones: new Map([['u1', '6085550199']]),
    stripe: [
      { name: 'Ridge Roofing', email: 'OWNER@ridge.example', phone: null },
      { name: 'Ridge Roofing', email: 'billing@ridge.example', phone: '(608) 555-0100' },
    ],
  });
  assert.deepEqual(
    contacts.map((c) => [c.role, c.email, c.phone]),
    [
      ['Owner', 'owner@ridge.example', '+16085550199'],
      ['Accountant', 'books@ridge.example', null],
      ['Stripe billing', 'billing@ridge.example', '+16085550100'],
    ],
  );
});

test('assembly lists overdue invoices and past-due billing rows, most owed first', () => {
  const accounts = assembleOverdue({
    nowMs: NOW,
    stripeChecked: true,
    orgs: [
      { id: 'o1', name: 'Ridge Roofing', created_by: 'u1' },
      { id: 'o2', name: 'Past Due Co', created_by: null },
      { id: 'o3', name: 'Paid Up', created_by: null },
    ],
    billing: [
      { org_id: 'o1', status: 'active', stripe_customer_id: 'cus_A' },
      { org_id: 'o2', status: 'past_due', stripe_customer_id: 'cus_B' },
      { org_id: 'o3', status: 'active', stripe_customer_id: 'cus_C' },
    ],
    invoices: [
      invoice(),
      invoice({ id: 'in_2', amount_remaining: 1000, created: nowSec - 40 * DAY }),
      invoice({ id: 'in_3', customer: 'cus_C', attempt_count: 0 }),
      invoice({ id: 'in_4', customer: 'cus_unknown' }),
    ],
    members: [{ org_id: 'o1', user_id: 'u1', role: 'global_admin' }],
    profiles: new Map([['u1', { email: 'owner@ridge.example', full_name: 'Avery Ridge' }]]),
    phones: new Map(),
    messages: [
      {
        id: 'm1',
        org_id: 'o1',
        channel: 'email',
        recipient: 'owner@ridge.example',
        subject: 'Hi',
        body: 'Pay please',
        status: 'sent',
        error: null,
        sent_by_email: 'jack@jettx.ai',
        created_at: '2026-10-20T10:00:00Z',
      },
    ],
  });
  assert.deepEqual(accounts.map((a) => a.orgId), ['o1', 'o2']);
  const ridge = accounts[0]!;
  assert.equal(ridge.amountDueCents, 30900);
  assert.equal(ridge.daysOverdue, 40);
  assert.deepEqual(ridge.invoices.map((i) => i.id), ['in_2', 'in_1']);
  assert.equal(ridge.lastMessageAt, '2026-10-20T10:00:00Z');
  const pastDue = accounts[1]!;
  assert.equal(pastDue.amountDueCents, 0);
  assert.equal(pastDue.daysOverdue, null);
});

test('amounts are unknown (null) when Stripe could not be read', () => {
  const [a] = assembleOverdue({
    nowMs: NOW,
    stripeChecked: false,
    orgs: [{ id: 'o2', name: 'Past Due Co', created_by: null }],
    billing: [{ org_id: 'o2', status: 'past_due' }],
    invoices: [],
    members: [],
    profiles: new Map(),
    phones: new Map(),
    messages: [],
  });
  assert.equal(a!.amountDueCents, null);
});

test('send guard: texts only from production with Twilio, email log-only outside production', () => {
  const ready = { emailReady: true, smsReady: true };
  assert.equal(overdueSendBlocker('email', {}, true, ready), null);
  assert.equal(overdueSendBlocker('email', {}, false, ready)?.code, 'overdue_dev_guard');
  assert.equal(overdueSendBlocker('email', { SYSTEM_MAIL_DRIVER: 'log' }, false, ready), null);
  assert.equal(overdueSendBlocker('sms', { SYSTEM_MAIL_DRIVER: 'log' }, false, ready)?.code, 'overdue_dev_guard');
  assert.equal(overdueSendBlocker('sms', {}, true, { emailReady: true, smsReady: false })?.code, 'sms_unconfigured');
  assert.equal(overdueSendBlocker('sms', {}, true, ready), null);
});

function account(): OverdueAccount {
  return {
    orgId: 'o1',
    name: 'Ridge Roofing',
    billingStatus: 'past_due',
    planCode: 'pro',
    stripeCustomerId: 'cus_A',
    mrrCents: 29900,
    amountDueCents: 29900,
    currency: 'usd',
    oldestDueAt: null,
    daysOverdue: 10,
    invoices: [],
    contacts: [{ name: 'Avery', email: 'owner@ridge.example', phone: '+16085550199', role: 'Owner' }],
    messages: [],
    lastMessageAt: null,
  };
}

test('only listed billing contacts can be messaged', () => {
  assert.deepEqual(allowedRecipients(account(), 'email', ['Owner@Ridge.example']), ['owner@ridge.example']);
  assert.deepEqual(allowedRecipients(account(), 'sms', ['(608) 555-0199']), ['+16085550199']);
  assert.throws(() => allowedRecipients(account(), 'email', ['someone@else.example']), /not a billing contact/);
  assert.throws(() => allowedRecipients(account(), 'sms', ['6085550000']), /not a billing contact/);
});

test('each send is logged with who sent it and the outcome', async () => {
  const rows: Array<Record<string, unknown>> = [];
  const admin = {
    from: () => ({ insert: async (row: Record<string, unknown>) => (rows.push(row), { error: null }) }),
  } as unknown as Parameters<typeof sendOverdueMessage>[0]['admin'];
  const emails: string[] = [];
  const results = await sendOverdueMessage(
    {
      admin,
      account: account(),
      logOnly: false,
      sendEmail: async (m) => (emails.push(m.to), { ok: true }),
      sendText: async () => ({ ok: false, message: 'Twilio said no' }),
      sender: { userId: 'staff-1', email: 'jack@jettx.ai' },
    },
    { channel: 'email', recipients: ['owner@ridge.example'], subject: 'Past due', body: 'Please pay.' },
  );
  assert.deepEqual(emails, ['owner@ridge.example']);
  assert.deepEqual(results, [{ recipient: 'owner@ridge.example', status: 'sent', error: null }]);
  assert.equal(rows[0]!.sent_by_email, 'jack@jettx.ai');
  assert.equal(rows[0]!.amount_due_cents, 29900);

  const sms = await sendOverdueMessage(
    {
      admin,
      account: account(),
      logOnly: false,
      sendEmail: async () => ({ ok: true }),
      sendText: async () => ({ ok: false, message: 'Twilio said no' }),
      sender: { userId: null, email: null },
    },
    { channel: 'sms', recipients: ['6085550199'], subject: null, body: 'Pay please' },
  );
  assert.equal(sms[0]!.status, 'failed');
  assert.equal(rows[1]!.channel, 'sms');
  assert.equal(rows[1]!.error, 'Twilio said no');

  await assert.rejects(
    sendOverdueMessage(
      { admin, account: account(), logOnly: false, sendEmail: async () => ({ ok: true }), sendText: async () => ({ ok: true, id: 'x' }), sender: { userId: null, email: null } },
      { channel: 'email', recipients: ['owner@ridge.example'], subject: '', body: 'x' },
    ),
    /Add a subject/,
  );
});
