import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationFeeCents,
  assertEvidenceOnJob,
  feeConfigFromEnv,
  homeownerInvoice,
  homeownerVisibleInvoice,
  invoiceTotalCents,
  mayManageInvoices,
  paymentStatusFromSession,
  paymentsGate,
  presentInvoice,
} from '../src/payments/model.js';
import { DEFAULT_HOMEOWNER_PERMISSIONS } from '../src/shared/homeownerPermissions.js';
import { isJobPaymentMetadata } from '../src/payments/webhook.js';

test('fee: basis points + flat, capped at the charge', () => {
  assert.equal(applicationFeeCents(10_000, { bps: 300, flatCents: 0 }), 300);
  assert.equal(applicationFeeCents(10_000, { bps: 250, flatCents: 30 }), 280);
  assert.equal(applicationFeeCents(100, { bps: 2000, flatCents: 500 }), 100);
  assert.deepEqual(feeConfigFromEnv({}), { bps: 300, flatCents: 0 });
  assert.equal(feeConfigFromEnv({ PAYMENTS_APPLICATION_FEE_BPS: '99999' }).bps, 2000);
});

test('gate: off by default, refuses a live key outside production', () => {
  assert.equal(paymentsGate('sk_test_x', {}).enabled, false);
  assert.equal(paymentsGate('sk_test_x', { PAYMENTS_CONNECT_ENABLED: '1' }).enabled, true);
  assert.equal(paymentsGate('sk_live_x', { PAYMENTS_CONNECT_ENABLED: '1', NODE_ENV: 'development' }).reason, 'live_key_outside_production');
  assert.equal(
    paymentsGate('sk_live_x', { PAYMENTS_CONNECT_ENABLED: '1', NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'staging' }).reason,
    'live_key_outside_production',
  );
  assert.equal(paymentsGate('sk_live_x', { PAYMENTS_CONNECT_ENABLED: '1', NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'production' }).enabled, true);
});

test('roles: only owner and admin manage invoices', () => {
  assert.equal(mayManageInvoices('owner'), true);
  assert.equal(mayManageInvoices('admin'), true);
  assert.equal(mayManageInvoices('member'), false);
  assert.equal(mayManageInvoices('viewer'), false);
});

test('totals and evidence must be on the job', () => {
  assert.equal(invoiceTotalCents([{ quantity: 2.5, unitCents: 1000 }, { quantity: 1, unitCents: 99 }]), 2599);
  const line = { description: 'x', quantity: 1, unitCents: 1, evidence: [{ proofId: 'p9', atSeconds: null, quote: null }] };
  assert.throws(() => assertEvidenceOnJob([line], new Set(['p1'])), /on this job/);
  assert.doesNotThrow(() => assertEvidenceOnJob([line], new Set(['p9'])));
});

const inv = presentInvoice(
  { id: 'i1', job_id: 'j1', number: 1, title: 'Mitigation', kind: 'invoice', status: 'sent', currency: 'usd', total_cents: 5000,
    homeowner_note: 'Thanks', internal_note: 'margin 40%', sent_at: null, paid_at: null, created_at: '2026-10-23T00:00:00Z' },
  [{ id: 'l1', invoice_id: 'i1', position: 0, description: 'Drywall', quantity: '1', unit_cents: 5000, amount_cents: 5000,
     evidence: [{ proofId: 'p1', atSeconds: 12, quote: 'cut 2 ft' }, { proofId: 'p2', atSeconds: null, quote: null }] }],
  new Map([['p1', { id: 'p1', title: 'Kitchen', capturedAt: null }]]),
  150,
);

test('homeowner view hides internal note, fee, unshared clips and (when off) quotes', () => {
  const h = homeownerInvoice(inv, DEFAULT_HOMEOWNER_PERMISSIONS, new Set(['p2'])) as Record<string, unknown> & typeof inv;
  assert.equal('internalNote' in h, false);
  assert.equal('applicationFeeCents' in h, false);
  assert.deepEqual(h.lines[0]!.evidence.map((e) => e.proofId), ['p1']);
  assert.equal(h.lines[0]!.evidence[0]!.quote, 'cut 2 ft');
  const noQuotes = homeownerInvoice(inv, { ...DEFAULT_HOMEOWNER_PERMISSIONS, seeTranscripts: false }, new Set());
  assert.equal(noQuotes.lines[0]!.evidence[0]!.quote, null);
  const noVideos = homeownerInvoice(inv, { ...DEFAULT_HOMEOWNER_PERMISSIONS, seeVideos: false }, new Set());
  assert.equal(noVideos.lines[0]!.evidence.length, 0);
  assert.equal(homeownerVisibleInvoice('draft'), false);
  assert.equal(homeownerVisibleInvoice('void'), false);
  assert.equal(homeownerVisibleInvoice('sent'), true);
});

test('checkout status mapping and metadata routing', () => {
  assert.equal(paymentStatusFromSession({ status: 'complete', payment_status: 'paid' }), 'paid');
  assert.equal(paymentStatusFromSession({ status: 'complete', payment_status: 'unpaid' }), 'processing');
  assert.equal(paymentStatusFromSession({ status: 'expired', payment_status: 'unpaid' }), 'expired');
  assert.equal(isJobPaymentMetadata({ kind: 'job_payment', payment_id: 'x' }), true);
  assert.equal(isJobPaymentMetadata({ kind: 'ai_credits' }), false);
});

import { assertMayRelease, lineReleaseCents, verifyLine, holdAgeDays, type ClipAnalysis } from '../src/payments/model.js';

const clip = (id: string, text: string, analysisStatus = 'done', state = 'accepted'): [string, ClipAnalysis] => [
  id,
  { id, title: null, analysisStatus, state, text: text.toLowerCase() },
];

test('AI verification: clips must be analysed and show the scope item', () => {
  const clips = new Map([
    clip('c1', 'Technician removes drywall in the hallway with a two foot flood cut. "we cut two feet up the full hallway run"'),
    clip('c2', 'Kitchen overview', 'queued'),
  ]);
  const ok = verifyLine({ description: 'Line', evidence: [{ proofId: 'c1', atSeconds: 3, quote: 'We cut two feet up the full hallway run' }] }, 'Drywall flood cut, hallway', clips);
  assert.equal(ok.verified, true);
  assert.ok(ok.matchedTerms.includes('drywall'));

  const none = verifyLine({ description: 'Drywall', evidence: [] }, null, clips);
  assert.equal(none.verified, false);
  const pending = verifyLine({ description: 'Kitchen', evidence: [{ proofId: 'c2', atSeconds: null, quote: null }] }, null, clips);
  assert.equal(pending.verified, false);
  const wrong = verifyLine({ description: 'x', evidence: [{ proofId: 'c1', atSeconds: null, quote: null }] }, 'Roof shingle replacement', clips);
  assert.equal(wrong.verified, false);
  const badQuote = verifyLine({ description: 'x', evidence: [{ proofId: 'c1', atSeconds: null, quote: 'we replaced the cabinets' }] }, 'Drywall flood cut', clips);
  assert.equal(badQuote.verified, false);
});

test('release: GC confirmation required; AI-only only when the company allows it', () => {
  assert.throws(() => assertMayRelease('unpaid', { aiOnly: false, allowAiRelease: false }), /not paid/);
  assert.throws(() => assertMayRelease('released', { aiOnly: false, allowAiRelease: false }), /already released/);
  assert.doesNotThrow(() => assertMayRelease('verified', { aiOnly: false, allowAiRelease: false }));
  assert.doesNotThrow(() => assertMayRelease('held', { aiOnly: false, allowAiRelease: false }));
  assert.throws(() => assertMayRelease('verified', { aiOnly: true, allowAiRelease: false }), /GC confirmation/);
  assert.throws(() => assertMayRelease('held', { aiOnly: true, allowAiRelease: true }), /GC confirmation/);
  assert.doesNotThrow(() => assertMayRelease('verified', { aiOnly: true, allowAiRelease: true }));
});

test('release amount: line minus Atmosphere fee; flat fee only once', () => {
  assert.equal(lineReleaseCents(120_000, { bps: 300, flatCents: 0 }, true), 116_400);
  assert.equal(lineReleaseCents(10_000, { bps: 300, flatCents: 50 }, true), 9_650);
  assert.equal(lineReleaseCents(10_000, { bps: 300, flatCents: 50 }, false), 9_700);
  assert.equal(holdAgeDays(new Date(Date.now() - 3 * 86_400_000).toISOString()), 3);
});

test('homeowner view hides the AI verdict and payout amount', () => {
  const office = presentInvoice(
    { id: 'i', job_id: 'j', number: 1, title: 't', kind: 'invoice', status: 'paid', currency: 'usd', total_cents: 100, homeowner_note: null, internal_note: null, sent_at: null, paid_at: null, created_at: '' },
    [{ id: 'l', invoice_id: 'i', position: 0, description: 'd', quantity: 1, unit_cents: 100, amount_cents: 100, evidence: [], release_status: 'released', release_cents: 97, release_mode: 'gc_confirmed', ai_verdict: { verified: true, reasons: ['x'] } }],
    new Map(),
  );
  assert.equal(office.lines[0].release.releasedCents, 97);
  const home = homeownerInvoice(office, DEFAULT_HOMEOWNER_PERMISSIONS, new Set());
  assert.equal(home.lines[0].release.status, 'released');
  assert.equal(home.lines[0].release.verdict, null);
  assert.equal(home.lines[0].release.releasedCents, null);
});

test('embeddedPublishableKey only hands the browser a key in the same mode as the secret key', async () => {
  const { embeddedPublishableKey } = await import('../src/payments/model.js');
  assert.equal(embeddedPublishableKey('sk_test_x', 'pk_test_y'), 'pk_test_y');
  assert.equal(embeddedPublishableKey('sk_test_x', 'pk_live_y'), '');
  assert.equal(embeddedPublishableKey('sk_live_x', 'pk_test_y'), '');
  assert.equal(embeddedPublishableKey('sk_test_x', 'sk_test_y'), '');
  assert.equal(embeddedPublishableKey('sk_test_x', ''), '');
});
