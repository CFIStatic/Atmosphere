/**
 * Atmosphere Analytics: product health mapping, tracking helpers, contacts and
 * campaigns. TEST DATA only: every address is @example.test and no test
 * reaches Stripe, Resend, SMTP or Supabase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpError } from '../src/lib/errors.js';
import { mapProductHealth } from '../src/analytics/productHealth.js';
import { trackCaptureUpload, uploadFailureCode } from '../src/analytics/captureUploadTracking.js';
import { askOutcomeForError, askTurnRow, trackAskTurn } from '../src/analytics/askTurnTracking.js';
import {
  contactFromStripeCustomer,
  contactStatusFromStripe,
  createStripeContactSource,
} from '../src/analytics/contacts/stripeSource.js';
import { crmContactSource } from '../src/analytics/contacts/crmSource.js';
import {
  createContactRegistry,
  dedupeContacts,
  filterContacts,
  normalizeAudience,
} from '../src/analytics/contacts/registry.js';
import type { Contact } from '../src/analytics/contacts/types.js';
import {
  buildCampaignEmail,
  campaignMarkdownToText,
  renderCampaignMarkdown,
  unsubscribeUrlFor,
} from '../src/analytics/campaignEmail.js';
import {
  campaignSendBlocker,
  campaignSendingEnabled,
  sendCampaign,
  type CampaignMailer,
} from '../src/analytics/campaigns.js';
import { deliverabilityHeaders } from '../src/lib/mailDeliverability.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------- product health

test('mapProductHealth: north star uses the last complete weeks, not the partial one', () => {
  const week = (start: string, partial: boolean, perSeat: number | null) => ({
    week_start: start,
    partial,
    paying_seats: 4,
    paying_orgs: 2,
    hours_paying: 8,
    hours_all: 9,
    films: 5,
    hours_per_seat: perSeat,
  });
  const health = mapProductHealth({
    generated_at: '2026-10-02T15:00:00Z',
    weeks: 3,
    north_star: { weekly: [week('2026-09-14', false, 1.5), week('2026-09-21', false, 2), week('2026-09-28', true, 0.4)] },
    uploads: {
      tracking_since: null,
      current: { started: 10, completed: 6, failed: 1, abandoned: 1, in_flight: 2, retried: 1, retrying: 0 },
      prior: {},
      top_errors: [{ code: 'upload_part_missing', count: 1 }],
    },
    analysis: { current: { median_seconds: 1200 }, prior: {}, weekly: [] },
    evidence: { current: {}, prior: {}, lifetime: { share_links: 3, share_link_opens: 7 } },
    ask: { questions: { current: 4 }, current: { turns: 10, errors: 1, median_ms: 2000 }, prior: {} },
    windows: { current: { from: '2026-09-04', to: '2026-10-02' }, prior: { from: '2026-08-07', to: '2026-09-04' } },
  });
  assert.equal(health.northStar.latest?.weekStart, '2026-09-21');
  assert.equal(health.northStar.latest?.hoursPerSeat, 2);
  assert.equal(health.northStar.previous?.hoursPerSeat, 1.5);
  // 6 completed of (10 started − 2 still in flight)
  assert.equal(health.uploads.current.completionRatePct, 75);
  assert.equal(health.ask.current.errorRatePct, 10);
  assert.equal(health.ask.feedback, null);
  assert.equal(health.analysis.current.medianSeconds, 1200);
  assert.equal(health.uploads.prior.completionRatePct, null);
});

test('mapProductHealth: tolerates an empty payload', () => {
  const health = mapProductHealth(null);
  assert.equal(health.northStar.latest, null);
  assert.deepEqual(health.northStar.weekly, []);
});

// ---------------------------------------------------------------- tracking

test('uploadFailureCode only counts upload_* errors', () => {
  assert.equal(uploadFailureCode(new HttpError(400, 'x', 'upload_part_missing')), 'upload_part_missing');
  assert.equal(uploadFailureCode(new HttpError(400, 'x', 'invalid_job')), null);
  assert.equal(uploadFailureCode(new Error('boom')), null);
});

test('trackCaptureUpload never throws and skips bad ids', async () => {
  const calls: unknown[] = [];
  const client = { rpc: (fn: string, args: unknown) => { calls.push([fn, args]); return Promise.resolve({ error: null }); } };
  trackCaptureUpload(client, { orgId: 'not-a-uuid', uploadKey: 'k', event: 'start' });
  trackCaptureUpload(client, { orgId: ORG_A, uploadKey: '', event: 'start' });
  trackCaptureUpload(null, { orgId: ORG_A, uploadKey: 'k', event: 'start' });
  trackCaptureUpload({ rpc: () => { throw new Error('down'); } }, { orgId: ORG_A, uploadKey: 'k', event: 'start' });
  trackCaptureUpload({ rpc: () => Promise.reject(new Error('down')) }, { orgId: ORG_A, uploadKey: 'k', event: 'fail' });
  trackCaptureUpload(client, { orgId: ORG_A, jobId: 'nope', uploadKey: ' org/a.mp4 ', event: 'complete' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [
    ['record_capture_upload', { p_org: ORG_A, p_upload_key: 'org/a.mp4', p_event: 'complete', p_job: null, p_error_code: null }],
  ]);
});

test('ask turn outcomes and rows', async () => {
  assert.deepEqual(askOutcomeForError(new HttpError(429, 'x', 'ai_budget_exhausted')), { outcome: 'refused', code: 'ai_budget_exhausted' });
  assert.deepEqual(askOutcomeForError(new HttpError(502, 'x', 'upstream')), { outcome: 'error', code: 'upstream' });
  assert.equal(askOutcomeForError(Object.assign(new Error('a'), { name: 'AbortError' })).outcome, 'stopped');
  const row = askTurnRow({ orgId: ORG_A, surface: 'job', outcome: 'answered', totalMs: 1234.6, ttftMs: -1, model: ' m ' });
  assert.equal(row.total_ms, 1235);
  assert.equal(row.ttft_ms, null);
  assert.equal(row.model, 'm');
  let inserted = 0;
  const client = { from: () => ({ insert: () => { inserted++; return Promise.resolve({ error: null }); } }) };
  trackAskTurn(client, { orgId: 'bad', surface: 'job', outcome: 'answered', totalMs: 1 });
  trackAskTurn({ from: () => { throw new Error('down'); } }, { orgId: ORG_A, surface: 'job', outcome: 'answered', totalMs: 1 });
  trackAskTurn(client, { orgId: ORG_A, surface: 'progress_share', outcome: 'error', totalMs: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(inserted, 1);
});

// ---------------------------------------------------------------- contacts

function contact(over: Partial<Contact> & { email: string }): Contact {
  return {
    name: null,
    company: null,
    orgId: null,
    plan: null,
    status: 'none',
    createdAt: null,
    sources: ['stripe'],
    ...over,
  };
}

test('Stripe customer mapping (TEST DATA)', () => {
  assert.equal(contactStatusFromStripe('unpaid'), 'past_due');
  assert.equal(contactStatusFromStripe('incomplete_expired'), 'canceled');
  assert.equal(contactStatusFromStripe(undefined), 'none');
  const names = new Map([[ORG_A, 'Test Roofing Co (TEST DATA)']]);
  const mapped = contactFromStripeCustomer(
    {
      id: 'cus_test_1',
      email: '  Ops@Example.TEST ',
      name: 'Test Person',
      created: 1_790_000_000,
      metadata: { org_id: ORG_A },
      subscriptions: {
        data: [
          { status: 'canceled', items: { data: [{ price: { id: 'price_test_old', nickname: 'Legacy' } }] } },
          { status: 'active', items: { data: [{ price: { id: 'price_test_new', nickname: 'Scale' } }] } },
        ],
      },
    },
    names,
  );
  assert.ok(mapped);
  assert.equal(mapped.email, 'ops@example.test');
  assert.equal(mapped.company, 'Test Roofing Co (TEST DATA)');
  assert.equal(mapped.status, 'active');
  assert.equal(mapped.plan, 'Scale');
  assert.equal(mapped.createdAt, new Date(1_790_000_000_000).toISOString());
  assert.equal(contactFromStripeCustomer({ id: 'x', email: null }, names), null);
  assert.equal(contactFromStripeCustomer({ id: 'x', email: 'a@example.test', deleted: true }, names), null);
});

test('Stripe source paginates, caps and resolves org names through the admin client', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `cus_test_${i}`,
    email: `user${i}@example.test`,
    created: 1_790_000_000 + i,
    metadata: i === 0 ? { org_id: ORG_B } : {},
    subscriptions: { data: [] },
  }));
  let listArgs: unknown = null;
  const stripe = {
    customers: {
      list: (args: unknown) => {
        listArgs = args;
        return (async function* () {
          yield* rows;
        })();
      },
    },
  };
  const admin = {
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({ data: ids.map((id) => ({ id, name: 'Test Org B (TEST DATA)' })), error: null }),
      }),
    }),
  };
  const source = createStripeContactSource({
    stripe: () => stripe as never,
    admin: () => admin as never,
    secretKeyConfigured: () => true,
    cap: 3,
  });
  const result = await source.list();
  assert.deepEqual(listArgs, { limit: 100, expand: ['data.subscriptions'] });
  assert.equal(result.contacts.length, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.contacts[0]!.company, 'Test Org B (TEST DATA)');

  const off = createStripeContactSource({ stripe: () => { throw new Error('no'); }, admin: () => null, secretKeyConfigured: () => false });
  assert.equal(off.availability().enabled, false);
});

test('CRM source is registered, disabled, and never lists', async () => {
  assert.equal(crmContactSource.availability().enabled, false);
  assert.match(crmContactSource.availability().reason ?? '', /coming soon/i);
});

test('dedupe merges by email across sources', () => {
  const merged = dedupeContacts([
    contact({ email: 'A@example.test', name: null, status: 'canceled', plan: 'starter', createdAt: '2026-03-01T00:00:00Z', sources: ['stripe'] }),
    contact({ email: 'a@example.test', name: 'Alex Test', company: 'Test Co', status: 'active', plan: 'scale', createdAt: '2026-01-01T00:00:00Z', sources: ['crm'] }),
    contact({ email: 'b@example.test' }),
  ]);
  assert.equal(merged.length, 2);
  const a = merged[0]!;
  assert.equal(a.email, 'a@example.test');
  assert.equal(a.name, 'Alex Test');
  assert.equal(a.status, 'active');
  assert.equal(a.plan, 'scale');
  assert.equal(a.createdAt, '2026-01-01T00:00:00Z');
  assert.deepEqual(a.sources, ['stripe', 'crm']);
});

test('audience filters and normalisation', () => {
  const list = [
    contact({ email: 'a@example.test', plan: 'scale', status: 'active' }),
    contact({ email: 'b@example.test', plan: 'starter', status: 'trialing' }),
    contact({ email: 'c@example.test', plan: null, status: 'none' }),
  ];
  assert.equal(filterContacts(list, normalizeAudience({})).length, 3);
  assert.deepEqual(filterContacts(list, normalizeAudience({ plans: ['Scale'] })).map((c) => c.email), ['a@example.test']);
  assert.deepEqual(filterContacts(list, normalizeAudience({ plans: ['none'] })).map((c) => c.email), ['c@example.test']);
  assert.deepEqual(filterContacts(list, normalizeAudience({ statuses: ['trialing', 'bogus'] })).map((c) => c.email), ['b@example.test']);
  assert.deepEqual(normalizeAudience({ statuses: ['bogus'], sources: ['crm', 'x'] }), { plans: [], statuses: [], sources: ['crm'] });
});

test('registry caches, refreshes, and reports disabled sources', async () => {
  let loads = 0;
  let clock = 0;
  const registry = createContactRegistry(
    [
      {
        id: 'stripe',
        label: 'Stripe',
        availability: () => ({ enabled: true, reason: null }),
        list: async () => {
          loads++;
          return { contacts: [contact({ email: 'a@example.test' })], truncated: false };
        },
      },
      crmContactSource,
    ],
    { ttlMs: 1000, now: () => clock },
  );
  const first = await registry.load();
  assert.equal(first.cached, false);
  assert.equal((await registry.load()).cached, true);
  clock = 2000;
  await registry.load();
  await registry.load({ refresh: true });
  assert.equal(loads, 3);
  assert.deepEqual(
    first.sources.map((s) => [s.id, s.enabled]),
    [
      ['stripe', true],
      ['crm', false],
    ],
  );
});

// ---------------------------------------------------------------- campaign email

test('markdown renderer escapes HTML and only allows safe links', () => {
  const html = renderCampaignMarkdown(
    '# Hello <b>there</b>\n\nA **bold** and *quiet* line with [a link](https://example.test/x?a=1&b=2).\n\n- one\n- [bad](javascript:alert(1))\n\n<script>alert(1)</script>',
  );
  assert.match(html, /<h1>Hello &lt;b&gt;there&lt;\/b&gt;<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>quiet<\/em>/);
  assert.match(html, /<a href="https:\/\/example.test\/x\?a=1&amp;b=2">a link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>\[bad\]\(javascript:alert\(1\)\)<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(campaignMarkdownToText('# Hi\n\n**Bold** [x](https://example.test)'), 'Hi\n\nBold x (https://example.test)');
});

test('campaign email carries an unsubscribe link and postal address', () => {
  const url = unsubscribeUrlFor('https://platform.example.test/', 'tok en');
  assert.equal(url, 'https://platform.example.test/api/unsubscribe?t=tok%20en');
  const email = buildCampaignEmail({ subject: 'Q4 update', bodyMarkdown: 'Hi', unsubscribeUrl: url, postalAddress: '1 Test St' });
  assert.match(email.html, /href="https:\/\/platform.example.test\/api\/unsubscribe\?t=tok%20en"/);
  assert.match(email.text, /Unsubscribe: https:\/\/platform.example.test\/api\/unsubscribe\?t=tok%20en/);
  assert.match(email.html, /1 Test St/);
  const headers = deliverabilityHeaders({ kind: 'marketing', unsubscribeUrl: url });
  assert.equal(headers['List-Unsubscribe'], `<${url}>`);
  assert.equal(headers['Auto-Submitted'], undefined);
});

// ---------------------------------------------------------------- sending guard

test('sending is off by default and needs the log sink outside production', () => {
  assert.equal(campaignSendingEnabled({}), false);
  assert.equal(campaignSendBlocker({}, true)?.code, 'campaign_sending_disabled');
  assert.equal(campaignSendBlocker({ CAMPAIGN_SENDING_ENABLED: 'yes' }, true)?.code, 'campaign_sending_disabled');
  assert.equal(campaignSendBlocker({ CAMPAIGN_SENDING_ENABLED: 'true' }, false)?.code, 'campaign_sending_dev_guard');
  assert.equal(campaignSendBlocker({ CAMPAIGN_SENDING_ENABLED: 'true', SYSTEM_MAIL_DRIVER: 'resend' }, false)?.code, 'campaign_sending_dev_guard');
  assert.equal(campaignSendBlocker({ CAMPAIGN_SENDING_ENABLED: 'true', SYSTEM_MAIL_DRIVER: 'log' }, false), null);
  assert.equal(campaignSendBlocker({ CAMPAIGN_SENDING_ENABLED: 'true' }, true)?.code, 'campaign_postal_address_missing');
  assert.equal(campaignSendBlocker({ CAMPAIGN_SENDING_ENABLED: 'true', CAMPAIGN_POSTAL_ADDRESS: '1 Test St' }, true), null);
});

const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';

function fakeSupabase(opts: { suppressed?: string[] } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const campaignRow = {
    id: CAMPAIGN_ID,
    name: 'TEST DATA campaign',
    subject: 'Hello',
    body_markdown: 'Body',
    audience: { plans: ['scale'] },
    status: 'draft',
  };
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === 'analytics_campaign_get') return { data: campaignRow, error: null };
      if (fn === 'analytics_email_suppressed') {
        return { data: (args.p_emails as string[]).filter((e) => opts.suppressed?.includes(e)), error: null };
      }
      if (fn === 'analytics_campaign_begin_send') {
        return {
          data: { recipients: (args.p_emails as string[]).map((email) => ({ email, token: `tok-${email}` })), suppressed: 0 },
          error: null,
        };
      }
      if (fn === 'analytics_campaign_finish_send') return { data: { ...campaignRow, status: 'sent' }, error: null };
      return { data: null, error: { message: `unexpected ${fn}` } };
    },
  };
  return { client, calls };
}

const audienceContacts = async () => [
  contact({ email: 'one@example.test', plan: 'scale', status: 'active' }),
  contact({ email: 'two@example.test', plan: 'scale', status: 'active' }),
  contact({ email: 'gone@example.test', plan: 'scale', status: 'active' }),
  contact({ email: 'other@example.test', plan: 'starter', status: 'active' }),
];

test('send is refused while the flag is off, and nothing is mailed', async () => {
  const { client, calls } = fakeSupabase();
  let mailed = 0;
  const mailer: CampaignMailer = async () => { mailed++; return { ok: true }; };
  await assert.rejects(
    sendCampaign(
      { supabase: client as never, contacts: audienceContacts, mailer, origin: 'https://platform.example.test', env: {}, isProduction: true },
      CAMPAIGN_ID,
      2,
    ),
    (err: HttpError) => err.status === 403 && err.code === 'campaign_sending_disabled',
  );
  assert.equal(mailed, 0);
  assert.equal(calls.length, 0);
});

test('send requires the confirmed count to match the live audience', async () => {
  const { client, calls } = fakeSupabase({ suppressed: ['gone@example.test'] });
  let mailed = 0;
  const mailer: CampaignMailer = async () => { mailed++; return { ok: true }; };
  const env = { CAMPAIGN_SENDING_ENABLED: 'true', SYSTEM_MAIL_DRIVER: 'log' };
  await assert.rejects(
    sendCampaign({ supabase: client as never, contacts: audienceContacts, mailer, origin: 'https://platform.example.test', env, isProduction: false }, CAMPAIGN_ID, 3),
    (err: HttpError) => err.code === 'campaign_count_changed',
  );
  assert.equal(mailed, 0);
  assert.ok(!calls.some(([fn]) => fn === 'analytics_campaign_begin_send'));
});

test('send mails each unsuppressed recipient once with its own unsubscribe link (fake mailer)', async () => {
  const { client, calls } = fakeSupabase({ suppressed: ['gone@example.test'] });
  const sent: Array<{ to: string; unsubscribeUrl: string; html: string }> = [];
  const mailer: CampaignMailer = async (mail) => {
    sent.push(mail);
    return mail.to === 'two@example.test' ? { ok: false, why: 'bounced (TEST)' } : { ok: true };
  };
  const env = { CAMPAIGN_SENDING_ENABLED: 'true', SYSTEM_MAIL_DRIVER: 'log' };
  const result = await sendCampaign(
    { supabase: client as never, contacts: audienceContacts, mailer, origin: 'https://platform.example.test', env, isProduction: false },
    CAMPAIGN_ID,
    2,
  );
  assert.deepEqual(sent.map((m) => m.to).sort(), ['one@example.test', 'two@example.test']);
  assert.equal(sent.find((m) => m.to === 'one@example.test')!.unsubscribeUrl, 'https://platform.example.test/api/unsubscribe?t=tok-one%40example.test');
  assert.ok(sent.every((m) => m.html.includes(m.unsubscribeUrl.replace(/&/g, '&amp;'))));
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.suppressed, 1);
  const finish = calls.find(([fn]) => fn === 'analytics_campaign_finish_send')!;
  assert.equal((finish[1].p_results as unknown[]).length, 2);
});

// ---------------------------------------------------------------- wiring

test('contacts and campaign routes are internal-scope only', () => {
  const src = readFileSync(new URL('../src/routes/analytics.ts', import.meta.url), 'utf8');
  const routes = [...src.matchAll(/analyticsRouter\.(get|post|put|delete)\(\s*'(\/(?:contacts|campaigns)[^']*)',\s*\n?\s*([^,]+),/g)];
  assert.equal(routes.length, 8);
  for (const [, method, path, guard] of routes) {
    assert.equal(guard!.trim(), "requireAnalytics('internal')", `${method} ${path}`);
  }
});

test('campaign migration keeps every RPC service_role only and staff-checked', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261002211000_atmosphere_analytics_campaigns.sql', import.meta.url),
    'utf8',
  );
  for (const fn of [
    'analytics_campaigns_list',
    'analytics_campaign_get',
    'analytics_campaign_save',
    'analytics_campaign_delete',
    'analytics_email_suppressed',
    'analytics_campaign_begin_send',
    'analytics_campaign_finish_send',
  ]) {
    assert.match(sql, new RegExp(`'public\\.${fn}\\([^)]*\\)'::regprocedure`), fn);
  }
  assert.match(sql, /revoke all on function %s from public, anon, authenticated/);
  assert.match(sql, /grant execute on function %s to service_role/);
  assert.equal((sql.match(/perform private\.require_analytics\('internal'\)/g) ?? []).length, 7);
});
