import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverduePage } from './OverduePage';
import type { OverdueAccount, OverdueResponse } from '../lib/overdue';
import { templateText, phoneLabel } from '../lib/overdue';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: { overdue: vi.fn(), messageOverdue: vi.fn() } };
});

import { api } from '../lib/api';

const ridge: OverdueAccount = {
  orgId: '00000000-0000-4000-8000-000000000001',
  name: 'Ridge Roofing (TEST DATA)',
  billingStatus: 'past_due',
  planCode: 'pro',
  stripeCustomerId: 'cus_test',
  mrrCents: 29900,
  amountDueCents: 59800,
  currency: 'usd',
  oldestDueAt: '2026-09-10T00:00:00Z',
  daysOverdue: 41,
  invoices: [
    {
      id: 'in_test_1',
      number: 'A1-0001',
      amountDueCents: 29900,
      currency: 'usd',
      createdAt: '2026-09-10T00:00:00Z',
      dueAt: '2026-09-10T00:00:00Z',
      attempts: 4,
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
      description: 'Atmosphere Pro',
    },
  ],
  contacts: [
    { name: 'Avery Ridge', email: 'avery@example.test', phone: '+16085550199', role: 'Owner' },
    { name: 'Blake Books', email: 'blake@example.test', phone: null, role: 'Accountant' },
  ],
  messages: [],
  lastMessageAt: null,
};

const payload = (over: Partial<OverdueResponse> = {}): OverdueResponse => ({
  generatedAt: '2026-10-21T12:00:00Z',
  stripeChecked: true,
  stripeError: null,
  emailReady: true,
  smsReady: true,
  accounts: [ridge],
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <OverduePage />
    </MemoryRouter>,
  );
}

describe('OverduePage (TEST DATA)', () => {
  beforeEach(() => {
    vi.mocked(api.overdue).mockReset().mockResolvedValue(payload());
    vi.mocked(api.messageOverdue).mockReset();
  });

  it('lists workspaces behind on payments with amount, days and contacts', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Ridge Roofing (TEST DATA)')).toBeInTheDocument());
    expect(screen.getAllByText('$598.00').length).toBeGreaterThan(0);
    expect(screen.getByText('41 days')).toBeInTheDocument();
    expect(screen.getByText('2 email · 1 phone')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ridge Roofing (TEST DATA)'));
    expect(screen.getByText('avery@example.test')).toHaveAttribute('href', 'mailto:avery@example.test');
    expect(screen.getByText('(608) 555-0199')).toHaveAttribute('href', 'tel:+16085550199');
    expect(screen.getByText('Pay page')).toHaveAttribute('href', 'https://invoice.stripe.com/i/test');
  });

  it('emails the chosen billing contacts with an editable template', async () => {
    vi.mocked(api.messageOverdue).mockResolvedValue({ results: [{ recipient: 'avery@example.test', status: 'sent', error: null }] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Ridge Roofing (TEST DATA)')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /Email/ })[0]!);

    const dialog = screen.getByRole('dialog');
    const body = within(dialog).getByLabelText('Message') as HTMLTextAreaElement;
    expect(body.value).toContain('$598.00');
    expect(body.value).toContain('https://invoice.stripe.com/i/test');
    fireEvent.change(body, { target: { value: 'Hi Avery, please pay.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send email to 1 person' }));

    await waitFor(() => expect(within(dialog).getByText('Sent')).toBeInTheDocument());
    expect(api.messageOverdue).toHaveBeenCalledWith(ridge.orgId, {
      channel: 'email',
      recipients: ['avery@example.test'],
      subject: "Your Atmosphere payment didn't go through",
      body: 'Hi Avery, please pay.',
    });
  });

  it('turns Text off when texting is not set up', async () => {
    vi.mocked(api.overdue).mockResolvedValue(payload({ smsReady: false }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Ridge Roofing (TEST DATA)')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Text/ })[0]).toBeDisabled();
    expect(screen.getByText(/Texting is not set up yet/)).toBeInTheDocument();
  });

  it('shows an empty state when nobody owes anything', async () => {
    vi.mocked(api.overdue).mockResolvedValue(payload({ accounts: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Nobody is behind on payments.')).toBeInTheDocument());
  });
});

describe('overdue templates', () => {
  it('keeps texts short and names the amount and pay link', () => {
    const t = templateText('final', 'sms', ridge);
    expect(t.body.length).toBeLessThanOrEqual(600);
    expect(t.body).toContain('$598.00');
    expect(t.body).toContain('https://invoice.stripe.com/i/test');
  });

  it('greets the recipient by first name in email', () => {
    expect(templateText('reminder', 'email', ridge, ridge.contacts[1]).body.startsWith('Hi Blake,')).toBe(true);
    expect(templateText('reminder', 'email', { ...ridge, invoices: [] }).body).toContain('Settings > Billing');
  });

  it('formats US phone numbers', () => {
    expect(phoneLabel('+16085550199')).toBe('(608) 555-0199');
    expect(phoneLabel('+447700900123')).toBe('+447700900123');
  });
});
