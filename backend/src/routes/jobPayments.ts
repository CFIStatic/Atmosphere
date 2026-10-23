import { Router, type Request } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { requireOrgOwner } from '../middleware/requireOrgOwner.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { stripeClient } from '../lib/stripe.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { resolveOrgOrViewerAccess, viewerPartyId, type SharedJobAccess } from '../shared/jobProgressGrants.js';
import { homeownerLimits } from '../shared/homeownerPermissions.js';
import { homeownerSharingOf } from '../shared/homeownerSharing.js';
import {
  applicationFeeCents,
  assertChargeable,
  assertEvidenceOnJob,
  assertMayManageInvoices,
  assertPaymentsEnabled,
  feeConfigFromEnv,
  homeownerInvoice,
  homeownerVisibleInvoice,
  invoiceTotalCents,
  lineAmountCents,
  mayManageInvoices,
  paymentsGate,
  presentInvoice,
  type InvoiceRow,
  type LineRow,
  type ProofInfo,
} from '../payments/model.js';
import { connectedAccountPatch } from '../payments/webhook.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function gate() {
  return paymentsGate(config.stripe.secretKey);
}

function admin(): any {
  return unscopedAdminOrNull() ?? requireAdmin();
}

const jobPath = (jobId: string, extra = '') =>
  `${publicAppOrigin()}/job-progress?job=${encodeURIComponent(jobId)}&section=payments${extra}`;

/* ------------------------------------------------ Connect (owner, Billing) */

export const connectRouter = Router();
connectRouter.use(requireAuth, requireOrg, requireOrgOwner);

async function loadAccount(orgId: string) {
  const { data, error } = await admin()
    .from('org_payment_accounts')
    .select('org_id, stripe_account_id, livemode, charges_enabled, payouts_enabled, details_submitted, requirements_due, updated_at')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Could not load payouts.', 'payouts_load_failed');
  return data as any;
}

function presentAccount(row: any, feeBps: number) {
  return {
    available: gate().enabled,
    feeBps,
    feeFlatCents: feeConfigFromEnv().flatCents,
    testMode: !/^(sk|rk)_live_/.test(config.stripe.secretKey),
    account: row
      ? {
          connected: true,
          chargesEnabled: Boolean(row.charges_enabled),
          payoutsEnabled: Boolean(row.payouts_enabled),
          detailsSubmitted: Boolean(row.details_submitted),
          requirementsDue: (row.requirements_due ?? []).length,
          updatedAt: row.updated_at,
        }
      : null,
  };
}

/** GET /api/billing/connect */
connectRouter.get('/', async (req, res, next) => {
  try {
    const g = gate();
    const row = g.enabled ? await loadAccount(req.orgId!) : null;
    res.json(presentAccount(row, feeConfigFromEnv().bps));
  } catch (err) {
    next(err);
  }
});

/** POST /api/billing/connect/onboard — create the account once, return a Stripe onboarding link. */
connectRouter.post('/onboard', async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const orgId = req.orgId!;
    const stripe = stripeClient();
    let row = await loadAccount(orgId);
    if (!row) {
      const { data: org } = await admin().from('orgs').select('name').eq('id', orgId).maybeSingle();
      const account = await stripe.accounts.create(
        {
          country: 'US',
          email: req.user?.email ?? undefined,
          business_profile: { name: (org as any)?.name ?? undefined, mcc: '1799', product_description: 'Property damage restoration services' },
          controller: {
            fees: { payer: 'application' },
            losses: { payments: 'application' },
            stripe_dashboard: { type: 'express' },
            requirement_collection: 'stripe',
          },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
            us_bank_account_ach_payments: { requested: true },
          },
          metadata: { org_id: orgId },
        },
        { idempotencyKey: `atm-connect-account-${orgId}` },
      );
      const { error } = await admin().from('org_payment_accounts').insert({
        org_id: orgId,
        stripe_account_id: account.id,
        livemode: Boolean((account as any).livemode ?? /^(sk|rk)_live_/.test(config.stripe.secretKey)),
        created_by: req.user!.id,
        ...connectedAccountPatch(account),
      });
      if (error) throw new HttpError(500, 'Could not save the payout account.', 'payouts_save_failed');
      row = await loadAccount(orgId);
    }
    const base = `${publicAppOrigin()}/settings?section=billing`;
    const link = await stripe.accountLinks.create({
      account: row.stripe_account_id,
      type: 'account_onboarding',
      refresh_url: `${base}&payouts=refresh`,
      return_url: `${base}&payouts=return`,
    });
    res.json({ url: link.url });
  } catch (err) {
    next(err);
  }
});

/** POST /api/billing/connect/refresh — re-read status from Stripe (after returning from onboarding). */
connectRouter.post('/refresh', async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const row = await loadAccount(req.orgId!);
    if (!row) throw new HttpError(404, 'No payout account yet.', 'no_payout_account');
    const account = await stripeClient().accounts.retrieve(row.stripe_account_id);
    await admin().from('org_payment_accounts').update(connectedAccountPatch(account)).eq('org_id', req.orgId!);
    res.json(presentAccount(await loadAccount(req.orgId!), feeConfigFromEnv().bps));
  } catch (err) {
    next(err);
  }
});

/** POST /api/billing/connect/dashboard — one-time link into the Stripe Express dashboard. */
connectRouter.post('/dashboard', async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const row = await loadAccount(req.orgId!);
    if (!row?.details_submitted) throw new HttpError(409, 'Finish payout setup first.', 'payouts_incomplete');
    const link = await stripeClient().accounts.createLoginLink(row.stripe_account_id);
    res.json({ url: link.url });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------ Job invoices + payments */

export const jobPaymentsRouter = Router();
jobPaymentsRouter.use(requireAuth);

/** Office (org) or the job's homeowner. Subcontractors get no invoices. */
async function access(req: Request): Promise<SharedJobAccess & { homeowner: boolean }> {
  const a = await resolveOrgOrViewerAccess(req, req.params.jobId);
  if (a.access === 'viewer' && (viewerPartyId(a) || !a.homeownerPermissions)) {
    throw new HttpError(404, 'Not found.', 'not_found');
  }
  return { ...a, homeowner: a.access === 'viewer' };
}

async function assertJobInOrg(orgId: string, jobId: string) {
  const { data } = await admin().from('crm_jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle();
  if (!data) throw new HttpError(404, 'No such job.', 'not_found');
}

async function proofInfo(orgId: string, jobId: string): Promise<Map<string, ProofInfo>> {
  const { data } = await admin()
    .from('job_proofs')
    .select('id, title, captured_at, created_at')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('deleted_at', null);
  const out = new Map<string, ProofInfo>();
  for (const p of (data ?? []) as any[]) {
    out.set(String(p.id), { id: String(p.id), title: p.title ?? null, capturedAt: p.captured_at ?? p.created_at ?? null });
  }
  return out;
}

const INVOICE_COLS = 'id, job_id, number, title, kind, status, currency, total_cents, homeowner_note, internal_note, sent_at, paid_at, created_at';

async function loadInvoices(orgId: string, jobId: string, invoiceId?: string) {
  let q = admin().from('job_invoices').select(INVOICE_COLS).eq('org_id', orgId).eq('job_id', jobId);
  if (invoiceId) q = q.eq('id', invoiceId);
  const { data: invoices, error } = await q.order('number', { ascending: false });
  if (error) throw new HttpError(500, 'Could not load invoices.', 'invoices_load_failed');
  const ids = ((invoices ?? []) as any[]).map((i) => i.id);
  const { data: lines } = ids.length
    ? await admin().from('job_invoice_lines').select('id, invoice_id, position, description, quantity, unit_cents, amount_cents, evidence').eq('org_id', orgId).in('invoice_id', ids)
    : { data: [] };
  const byInvoice = new Map<string, LineRow[]>();
  for (const l of (lines ?? []) as LineRow[]) {
    byInvoice.set(l.invoice_id, [...(byInvoice.get(l.invoice_id) ?? []), l]);
  }
  const proofs = await proofInfo(orgId, jobId);
  return ((invoices ?? []) as InvoiceRow[]).map((inv) => ({ row: inv, lines: byInvoice.get(inv.id) ?? [], proofs }));
}

async function loadPayments(orgId: string, jobId: string) {
  const { data, error } = await admin()
    .from('job_payments')
    .select('id, invoice_id, amount_cents, application_fee_cents, status, method, payer_email, paid_at, created_at, livemode')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw new HttpError(500, 'Could not load payments.', 'payments_load_failed');
  return (data ?? []) as any[];
}

/** GET /api/operations/shared/:jobId/payments — invoices + payments for this job. */
jobPaymentsRouter.get('/shared/:jobId/payments', async (req, res, next) => {
  try {
    const a = await access(req);
    const g = gate();
    if (!g.enabled) {
      res.json({ available: false, invoices: [], payments: [], canManage: false, payoutsReady: false });
      return;
    }
    const fee = feeConfigFromEnv();
    const [invoices, payments, account] = await Promise.all([
      loadInvoices(a.orgId, req.params.jobId),
      loadPayments(a.orgId, req.params.jobId),
      admin().from('org_payment_accounts').select('charges_enabled').eq('org_id', a.orgId).maybeSingle(),
    ]);
    const payoutsReady = Boolean((account.data as any)?.charges_enabled);
    const testMode = !/^(sk|rk)_live_/.test(config.stripe.secretKey);
    if (a.homeowner) {
      const perms = homeownerLimits(a);
      const hidden = homeownerSharingOf(a)?.hiddenProofIds ?? new Set<string>();
      res.json({
        available: true,
        testMode,
        canManage: false,
        payoutsReady,
        invoices: invoices
          .filter((i) => homeownerVisibleInvoice(i.row.status))
          .map((i) => homeownerInvoice(presentInvoice(i.row, i.lines, i.proofs), perms, hidden)),
        // The homeowner sees their own payment outcomes, never the fee.
        payments: payments
          .filter((p) => p.status !== 'expired')
          .map((p) => ({ id: p.id, invoiceId: p.invoice_id, amountCents: Number(p.amount_cents), status: p.status, method: p.method, paidAt: p.paid_at, createdAt: p.created_at })),
      });
      return;
    }
    res.json({
      available: true,
      testMode,
      feeBps: fee.bps,
      canManage: mayManageInvoices((a as any).permissionRole),
      payoutsReady,
      invoices: invoices.map((i) => presentInvoice(i.row, i.lines, i.proofs, applicationFeeCents(Number(i.row.total_cents), fee))),
      payments: payments.map((p) => ({
        id: p.id,
        invoiceId: p.invoice_id,
        amountCents: Number(p.amount_cents),
        applicationFeeCents: Number(p.application_fee_cents),
        status: p.status,
        method: p.method,
        payerEmail: p.payer_email,
        paidAt: p.paid_at,
        createdAt: p.created_at,
        testMode: !p.livemode,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const evidenceSchema = z.object({
  proofId: z.string().uuid(),
  atSeconds: z.number().min(0).max(86_400).nullable().optional(),
  quote: z.string().trim().max(500).nullable().optional(),
});
const lineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(100_000),
  unitCents: z.number().int().min(0).max(10_000_000),
  evidence: z.array(evidenceSchema).max(10).default([]),
});
const invoiceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['invoice', 'deductible', 'out_of_pocket']).default('invoice'),
  homeownerNote: z.string().trim().max(2000).nullable().optional(),
  internalNote: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

async function officeAdmin(req: Request) {
  const ctx = await requireOrgContext(req);
  assertMayManageInvoices(ctx.permissionRole);
  await assertJobInOrg(ctx.orgId, req.params.jobId);
  return ctx;
}

async function writeLines(orgId: string, jobId: string, invoiceId: string, lines: z.infer<typeof lineSchema>[]) {
  const proofs = await proofInfo(orgId, jobId);
  const norm = lines.map((l) => ({
    ...l,
    evidence: l.evidence.map((e) => ({ proofId: e.proofId, atSeconds: e.atSeconds ?? null, quote: e.quote ?? null })),
  }));
  assertEvidenceOnJob(norm, new Set(proofs.keys()));
  await admin().from('job_invoice_lines').delete().eq('org_id', orgId).eq('invoice_id', invoiceId);
  const { error } = await admin().from('job_invoice_lines').insert(
    norm.map((l, position) => ({
      invoice_id: invoiceId,
      org_id: orgId,
      job_id: jobId,
      position,
      description: l.description,
      quantity: l.quantity,
      unit_cents: l.unitCents,
      amount_cents: lineAmountCents(l.quantity, l.unitCents),
      evidence: l.evidence,
    })),
  );
  if (error) throw new HttpError(500, 'Could not save invoice lines.', 'invoice_lines_failed');
  return invoiceTotalCents(norm);
}

/** POST /api/operations/shared/:jobId/invoices — owner/admin create a draft. */
jobPaymentsRouter.post('/shared/:jobId/invoices', async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const ctx = await officeAdmin(req);
    const input = invoiceSchema.parse(req.body ?? {});
    const jobId = req.params.jobId;
    const { data: last } = await admin()
      .from('job_invoices').select('number').eq('org_id', ctx.orgId).eq('job_id', jobId)
      .order('number', { ascending: false }).limit(1);
    const number = Number((last as any[] | null)?.[0]?.number ?? 0) + 1;
    const id = randomUUID();
    const { error } = await admin().from('job_invoices').insert({
      id, org_id: ctx.orgId, job_id: jobId, number, title: input.title, kind: input.kind,
      homeowner_note: input.homeownerNote ?? null, internal_note: input.internalNote ?? null,
      created_by: ctx.userId, total_cents: 0,
    });
    if (error) throw new HttpError(500, 'Could not create the invoice.', 'invoice_create_failed');
    const total = await writeLines(ctx.orgId, jobId, id, input.lines);
    await admin().from('job_invoices').update({ total_cents: total }).eq('id', id).eq('org_id', ctx.orgId);
    res.status(201).json({ id, number, totalCents: total });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/operations/shared/:jobId/invoices/:invoiceId — edit a draft. */
jobPaymentsRouter.put('/shared/:jobId/invoices/:invoiceId', async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const ctx = await officeAdmin(req);
    const input = invoiceSchema.parse(req.body ?? {});
    const [inv] = await loadInvoices(ctx.orgId, req.params.jobId, req.params.invoiceId);
    if (!inv) throw new HttpError(404, 'No such invoice.', 'not_found');
    if (inv.row.status !== 'draft') throw new HttpError(409, 'Only drafts can be edited.', 'invoice_not_draft');
    const total = await writeLines(ctx.orgId, req.params.jobId, inv.row.id, input.lines);
    await admin().from('job_invoices').update({
      title: input.title, kind: input.kind, homeowner_note: input.homeownerNote ?? null,
      internal_note: input.internalNote ?? null, total_cents: total, updated_at: new Date().toISOString(),
    }).eq('id', inv.row.id).eq('org_id', ctx.orgId);
    res.json({ id: inv.row.id, totalCents: total });
  } catch (err) {
    next(err);
  }
});

/** POST .../invoices/:invoiceId/send — show it to the homeowner (no email is sent). */
for (const action of ['send', 'void'] as const) jobPaymentsRouter.post(`/shared/:jobId/invoices/:invoiceId/${action}`, async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const ctx = await officeAdmin(req);
    const [inv] = await loadInvoices(ctx.orgId, req.params.jobId, req.params.invoiceId);
    if (!inv) throw new HttpError(404, 'No such invoice.', 'not_found');
    const now = new Date().toISOString();
    if (action === 'send') {
      if (inv.row.status !== 'draft') throw new HttpError(409, 'Already sent.', 'invoice_not_draft');
      assertChargeable(Number(inv.row.total_cents));
      await admin().from('job_invoices').update({ status: 'sent', sent_at: now, updated_at: now }).eq('id', inv.row.id).eq('org_id', ctx.orgId);
    } else {
      if (inv.row.status === 'paid') throw new HttpError(409, 'A paid invoice cannot be voided; refund it in Stripe.', 'invoice_paid');
      await admin().from('job_invoices').update({ status: 'void', voided_at: now, updated_at: now }).eq('id', inv.row.id).eq('org_id', ctx.orgId);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST .../invoices/:invoiceId/checkout — the homeowner pays by card or ACH.
 * Destination charge to the contractor's connected account; Atmosphere keeps
 * the application fee. Returns the Stripe Checkout URL.
 */
jobPaymentsRouter.post('/shared/:jobId/invoices/:invoiceId/checkout', async (req, res, next) => {
  try {
    assertPaymentsEnabled(gate());
    const a = await access(req);
    if (!a.homeowner) throw new HttpError(403, 'Only the homeowner pays an invoice.', 'homeowner_only');
    const [inv] = await loadInvoices(a.orgId, req.params.jobId, req.params.invoiceId);
    if (!inv || inv.row.status !== 'sent') throw new HttpError(404, 'No open invoice.', 'not_found');
    const amount = Number(inv.row.total_cents);
    assertChargeable(amount);
    const { data: acct } = await admin().from('org_payment_accounts').select('stripe_account_id, charges_enabled').eq('org_id', a.orgId).maybeSingle();
    if (!(acct as any)?.charges_enabled) {
      throw new HttpError(409, 'Your contractor has not finished setting up payments yet.', 'payouts_not_ready');
    }
    const destination = String((acct as any).stripe_account_id);
    const fee = applicationFeeCents(amount, feeConfigFromEnv());
    const paymentId = randomUUID();
    const { error } = await admin().from('job_payments').insert({
      id: paymentId, org_id: a.orgId, job_id: req.params.jobId, invoice_id: inv.row.id,
      stripe_account_id: destination, amount_cents: amount, application_fee_cents: fee,
      livemode: /^(sk|rk)_live_/.test(config.stripe.secretKey), payer_user_id: req.user!.id, status: 'pending',
    });
    if (error) throw new HttpError(500, 'Could not start the payment.', 'payment_create_failed');
    const metadata = { kind: 'job_payment', payment_id: paymentId, org_id: a.orgId, job_id: req.params.jobId, invoice_id: inv.row.id };
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card', 'us_bank_account'],
        customer_email: req.user?.email ?? undefined,
        line_items: [{
          quantity: 1,
          price_data: { currency: 'usd', unit_amount: amount, product_data: { name: `Invoice #${inv.row.number}: ${inv.row.title}`.slice(0, 250) } },
        }],
        payment_intent_data: {
          application_fee_amount: fee,
          on_behalf_of: destination,
          transfer_data: { destination },
          metadata,
        },
        metadata,
        success_url: jobPath(req.params.jobId, '&payment=success'),
        cancel_url: jobPath(req.params.jobId, '&payment=cancelled'),
      },
      { idempotencyKey: `atm-job-payment-${paymentId}` },
    );
    await admin().from('job_payments').update({ stripe_checkout_session_id: session.id }).eq('id', paymentId).eq('org_id', a.orgId);
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});
