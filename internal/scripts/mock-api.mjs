#!/usr/bin/env node
/**
 * Atmosphere Analytics mock API: DEVELOPMENT AND SCREENSHOTS ONLY.
 *
 *   node scripts/mock-api.mjs            # listens on :4000, where `npm run dev` proxies /api
 *
 * Every response is TEST DATA and carries `x-atmosphere-test-data: 1`, which
 * makes the UI show a TEST DATA ribbon. All addresses are @example.test and all
 * names are invented. Nothing here is imported by src/, so it is never part of
 * the production build. It never sends email: POST /campaigns/:id/send always
 * answers 403 campaign_sending_disabled, like the real API with the flag off.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);
const here = path.dirname(fileURLToPath(import.meta.url));

// Reuse the existing unit-test overview fixture (src/lib/demo.ts) for the
// legacy reports, transpiled on the fly.
async function loadDemo() {
  const src = await readFile(path.join(here, '../src/lib/demo.ts'), 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  const dir = await mkdtemp(path.join(tmpdir(), 'atm-mock-'));
  const file = path.join(dir, 'demo.mjs');
  await writeFile(file, code);
  return import(pathToFileURL(file).href);
}
const demo = await loadDemo();

// Deterministic PRNG so screenshots are stable.
let seed = 20261002;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const NOW = new Date(process.env.MOCK_NOW ?? Date.now());
const iso = (d) => d.toISOString();
const DAY = 86_400_000;

function mondayUtc(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - dow * DAY);
}

// ----------------------------------------------------------------- product health
function productHealth(weeks) {
  seed = 20261002; // same figures on every request
  const thisWeek = mondayUtc(NOW);
  const rows = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisWeek.getTime() - i * 7 * DAY);
    const partial = i === 0;
    const seats = 36 + Math.round((weeks - i) * 0.9);
    const perSeat = partial ? 0.92 : 1.18 + (weeks - i) * 0.072 + (rand() - 0.5) * 0.16;
    const hoursPaying = Math.round(perSeat * seats * 10) / 10;
    rows.push({
      weekStart: iso(ws).slice(0, 10),
      partial,
      payingSeats: seats,
      payingOrgs: 9 + Math.floor((weeks - i) / 4),
      hoursPaying,
      hoursAll: Math.round(hoursPaying * 1.12 * 10) / 10,
      films: Math.round(hoursPaying * 2.4),
      hoursPerSeat: Math.round(perSeat * 100) / 100,
    });
  }
  const complete = rows.filter((r) => !r.partial);
  const analysisWeekly = rows
    .filter((r) => !r.partial)
    .map((r, i, all) => ({
      weekStart: r.weekStart,
      analysed: r.films,
      // One week carries proofs whose first analysis time was lost to a bulk re-run.
      firstTimeUnknown: i === all.length - 3 ? 12 : 0,
      medianSeconds: Math.round((24 - i * 0.55 + (rand() - 0.5) * 2) * 60),
      p90Seconds: Math.round((58 - i * 1.4 + (rand() - 0.5) * 5) * 60),
    }));
  return {
    generatedAt: iso(NOW),
    weeks,
    windows: {
      current: { from: iso(new Date(NOW.getTime() - 28 * DAY)), to: iso(NOW) },
      prior: { from: iso(new Date(NOW.getTime() - 56 * DAY)), to: iso(new Date(NOW.getTime() - 28 * DAY)) },
    },
    northStar: { weekly: rows, latest: complete.at(-1) ?? null, previous: complete.at(-2) ?? null },
    uploads: {
      trackingSince: iso(new Date(NOW.getTime() - 70 * DAY)),
      current: { started: 1184, completed: 1121, failed: 19, abandoned: 11, inFlight: 33, retried: 96, retrying: 4, completionRatePct: 97.4 },
      prior: { started: 1032, completed: 961, failed: 27, abandoned: 15, inFlight: 29, retried: 104, retrying: 3, completionRatePct: 95.8 },
      topErrors: [
        { code: 'upload_part_missing', count: 9 },
        { code: 'upload_checksum_mismatch', count: 5 },
        { code: 'upload_too_large', count: 3 },
        { code: 'upload_expired', count: 2 },
      ],
    },
    analysis: {
      measuredTo: 'first_analysis',
      current: { received: 1121, analysed: 1098, firstTimeUnknown: 12, failed: 7, pending: 16, medianSeconds: 1126, p90Seconds: 2832 },
      prior: { received: 961, analysed: 934, firstTimeUnknown: 0, failed: 11, pending: 16, medianSeconds: 1288, p90Seconds: 3315 },
      weekly: analysisWeekly,
    },
    evidence: {
      current: { proofsAnalysed: 1098, dailyReportsSent: 412, evidenceDownloads: 187, shareLinksCreated: 96, shareLinksOpened: 71 },
      prior: { proofsAnalysed: 934, dailyReportsSent: 366, evidenceDownloads: 152, shareLinksCreated: 81, shareLinksOpened: null },
      lifetime: { shareLinks: 742, shareLinkOpens: 3918 },
    },
    ask: {
      trackingSince: iso(new Date(NOW.getTime() - 70 * DAY)),
      questions: { current: 1486, prior: 1203, orgsCurrent: 14 },
      current: { turns: 1531, answered: 1462, errors: 17, refused: 38, stopped: 14, errorRatePct: 1.1, medianMs: 4180, p90Ms: 9620, medianTtftMs: 870 },
      prior: { turns: 1247, answered: 1171, errors: 26, refused: 37, stopped: 13, errorRatePct: 2.1, medianMs: 4710, p90Ms: 11240, medianTtftMs: 1010 },
      feedback: null,
    },
  };
}

// ----------------------------------------------------------------- overview
function overview(includeInternal = false) {
  const o = structuredClone(demo.demoOverview);
  o.generatedAt = iso(NOW);
  o.range = { from: iso(new Date(NOW.getTime() - 365 * DAY)), to: iso(NOW) };
  o.monthly.push({ month: '2026-09-01', newOrgs: 1, totalOrgs: 15, payingOrgs: 12, activeOrgs: 13, churnedOrgs: 0, mrrCents: 232400, arrCents: 2788800, revenueCents: 232400, trackedHours: 57 });
  o.monthly.shift();
  o.summary.revenue.mrrCents = 232400;
  o.summary.revenue.arrCents = 2788800;
  o.summary.revenue.mrrGrowthMomPct = 6.4;
  o.summary.revenue.netNewMrrCents = 13900;
  o.summary.revenue.arpaMrrCents = 19367;
  o.summary.customers.orgsPaying = 12;
  o.summary.customers.orgsPayingPrev = 11;
  o.summary.customers.payingGrowthMomPct = 9.1;
  o.summary.customers.orgsGrowthMomPct = 7.1;
  o.summary.customers.orgsExcluded = 14;
  o.summary.includeInternal = includeInternal;
  o.includeInternal = includeInternal;
  o.summary.seats = { seatsLicensed: 50, seatsFilled: 41, seatUtilizationPct: 82, seatsGrowthMomPct: 4.2 };
  o.summary.revenue.churnedOrgsThisMonth = 0;
  o.planMix = [
    { planCode: 'work_verification', planName: 'Work Verification', billingInterval: 'monthly', orgs: 6, seats: 24, mrrCents: 127400, arrCents: 1528800, mrrSharePct: 54.8 },
    { planCode: 'scale', planName: 'Scale', billingInterval: 'annual', orgs: 2, seats: 20, mrrCents: 66600, arrCents: 799200, mrrSharePct: 28.7 },
    { planCode: 'starter', planName: 'Starter', billingInterval: 'monthly', orgs: 4, seats: 6, mrrCents: 38400, arrCents: 460800, mrrSharePct: 16.5 },
    { planCode: 'none', planName: 'No paid subscription', billingInterval: '—', orgs: 3, seats: 0, mrrCents: 0, arrCents: 0, mrrSharePct: null },
  ];
  if (includeInternal) {
    o.summary.customers.orgsTotal += 14;
    o.summary.customers.orgsExcluded = 0;
    o.planMix.push({ planCode: 'comp', planName: 'Comp (no charge)', billingInterval: '—', orgs: 7, seats: 21, mrrCents: 0, arrCents: 0, mrrSharePct: null });
  }
  return o;
}

// ----------------------------------------------------------------- contacts
const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Emerson', 'Finley', 'Harper', 'Jordan', 'Kendall', 'Logan', 'Morgan', 'Parker', 'Quinn', 'Reese', 'Riley', 'Rowan', 'Sawyer', 'Skyler', 'Taylor', 'Hayden'];
const LAST = ['Testwell', 'Sample', 'Example', 'Mockley', 'Fixture', 'Placeholder', 'Demo', 'Stubbs', 'Dummy', 'Specimen'];
const COMPANIES = [
  'Harbor Mitigation Co', 'Cedar Ridge Builders', 'Northwind Restoration', 'Bluestone Roofing', 'Summit Water Response',
  'Lakeside Remodeling', 'Ironwood Contracting', 'Prairie Drywall Group', 'Coastal Claims Services', 'Granite Peak Renovation',
  'Riverbend Construction', 'Oak Hollow Interiors', 'Redline Fire & Water', 'Silver Pine Homes',
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function buildContacts() {
  const out = [];
  const plans = ['work_verification', 'work_verification', 'scale', 'starter', null];
  const statuses = ['active', 'active', 'active', 'trialing', 'past_due', 'canceled', 'none'];
  for (let i = 0; i < 64; i++) {
    const company = COMPANIES[i % COMPANIES.length];
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = LAST[Math.floor(rand() * LAST.length)];
    let status = statuses[Math.floor(rand() * statuses.length)];
    let plan = plans[Math.floor(rand() * plans.length)];
    if (status === 'none') plan = null;
    if (plan === null && status !== 'canceled') status = 'none';
    const created = new Date(NOW.getTime() - Math.floor(rand() * 420 + 3) * DAY);
    const email = `${first}.${last}${i}@${slug(company)}.example.test`.toLowerCase();
    out.push({
      email,
      name: rand() < 0.08 ? null : `${first} ${last}`,
      company: rand() < 0.06 ? null : `${company}`,
      orgId: null,
      plan,
      status,
      createdAt: iso(created),
      sources: ['stripe'],
      suppressed: false,
    });
  }
  out.sort((a, b) => a.email.localeCompare(b.email));
  return out;
}
seed = 77;
const contacts = buildContacts();
const suppressed = new Set([contacts[5].email, contacts[17].email, contacts[40].email]);
for (const c of contacts) c.suppressed = suppressed.has(c.email);

function filterAudience(list, a) {
  return list.filter(
    (c) =>
      (!a.plans?.length || a.plans.includes((c.plan ?? 'none').toLowerCase())) &&
      (!a.statuses?.length || a.statuses.includes(c.status)) &&
      (!a.sources?.length || c.sources.some((s) => a.sources.includes(s))),
  );
}

// ----------------------------------------------------------------- campaigns
const SENDING = {
  enabled: false,
  reason: 'Campaign sending is turned off on this server (CAMPAIGN_SENDING_ENABLED is not true).',
  code: 'campaign_sending_disabled',
};
const campaigns = new Map();
function addCampaign(c) {
  const id = c.id ?? randomUUID();
  const row = {
    id,
    name: c.name,
    subject: c.subject,
    bodyMarkdown: c.bodyMarkdown,
    audience: { plans: [], statuses: [], sources: [], ...c.audience },
    status: 'draft',
    createdAt: iso(new Date(NOW.getTime() - (c.ageDays ?? 1) * DAY)),
    updatedAt: iso(new Date(NOW.getTime() - (c.ageDays ?? 1) * DAY + 3600_000)),
    sentAt: null,
    recipientCount: null,
    sentCount: null,
    failedCount: null,
    suppressedCount: null,
  };
  campaigns.set(id, row);
  return row;
}
addCampaign({
  id: '5b1d2c9e-6f0a-4c51-9f0e-2d7c1a9b0001',
  name: 'Q4 product update (TEST DATA)',
  subject: 'Faster analysis and evidence you can share in one click',
  audience: { plans: ['work_verification', 'scale'], statuses: ['active', 'past_due'] },
  ageDays: 2,
  bodyMarkdown: [
    '## What changed this quarter',
    '',
    'Analysis now finishes in a median of **under 19 minutes** from upload, down from 21 last quarter.',
    '',
    '- Share a job’s evidence with a carrier or homeowner in one click',
    '- Daily reports now include every film captured that day',
    '- Ask answers cite the exact clip they came from',
    '',
    'Questions? Reply to this email or read the [release notes](https://example.test/release-notes).',
    '',
    '*The Atmosphere team*',
  ].join('\n'),
});
addCampaign({
  name: 'Trial check-in (TEST DATA)',
  subject: 'How is your Atmosphere trial going?',
  audience: { statuses: ['trialing'] },
  ageDays: 6,
  bodyMarkdown: 'Hi,\n\nYou are a week into your trial. Here is how teams get the most from it.',
});
addCampaign({
  name: 'Win-back: canceled accounts (TEST DATA)',
  subject: '',
  audience: { statuses: ['canceled'] },
  ageDays: 9,
  bodyMarkdown: '',
});

// ------------------------------------------------------- AI cost (TEST DATA)
// Invented orgs and token counts. Every row is priced the way the real ledger
// is: provider tokens × official rate (USD per MTok) × 10, Tavily credits ×
// $0.008 × 10, so every total on the page adds up.
const MOCK_RATES = {
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2 },
  'gemini-3.6-flash': { in: 0.75, out: 3.75, cacheRead: 0.075 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5, cacheRead: 0.03 },
};
const MOCK_MARKUP = 10;
const TAVILY_USD_PER_CREDIT = 0.008;

function mockUsageRows() {
  const a = { orgId: 'aaaaaaaa-0000-4000-8000-000000000001', orgName: 'Test Restoration Co (TEST DATA)', userId: 'u-1', userName: 'Test Owner', email: 'owner@example.test' };
  const b = { orgId: 'aaaaaaaa-0000-4000-8000-000000000002', orgName: 'Sample Builders (TEST DATA)', userId: 'u-2', userName: 'Sample Estimator', email: 'estimator@example.test' };
  // [who, model, feature, events, input, output, cacheRead, tavilyCredits]
  const raw = [
    [a, 'claude-opus-5', 'ask', 10, 62_000, 7_400, 16_000, 0],
    [a, 'claude-sonnet-5', 'ask', 7, 21_000, 3_900, 25_000, 0],
    [a, 'claude-opus-5', 'video_analysis', 4, 48_000, 5_200, 0, 0],
    [a, 'gemini-3.6-flash', 'video_analysis', 9, 9_800, 1_200, 0, 0],
    [a, 'tavily-search', 'web_search', 2, 0, 0, 0, 2],
    [b, 'claude-sonnet-5', 'ask', 6, 18_400, 2_600, 9_000, 0],
    [b, 'claude-sonnet-5', 'chat', 2, 3_000, 500, 0, 0],
    [b, 'gemini-3.5-flash-lite', 'ask', 12, 21_700, 2_700, 0, 0],
    [b, 'tavily-search', 'web_search', 1, 0, 0, 0, 2],
  ];
  return raw.map(([who, model, feature, events, input, output, cache, credits]) => {
    const r = MOCK_RATES[model];
    const costUsd = r ? (input * r.in + output * r.out + cache * r.cacheRead) / 1e6 : credits * TAVILY_USD_PER_CREDIT;
    const costNanos = Math.round(costUsd * 1e9);
    return { ...who, model, feature, events, input, output, cache, costNanos, priceNanos: costNanos * MOCK_MARKUP };
  });
}

function groupUsage(rows, keyOf, seed) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const cur = map.get(key) ?? { ...seed(row), eventCount: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, priceNanos: 0, costNanos: 0, _orgs: new Set(), _users: new Set(), _models: new Set() };
    cur.eventCount += row.events; cur.inputTokens += row.input; cur.outputTokens += row.output; cur.cacheTokens += row.cache;
    cur.totalTokens += row.input + row.output + row.cache; cur.priceNanos += row.priceNanos; cur.costNanos += row.costNanos;
    cur._orgs.add(row.orgId); cur._users.add(row.userId); cur._models.add(row.model);
    map.set(key, cur);
  }
  return [...map.values()]
    .map(({ _orgs, _users, _models, ...rest }) => ({ ...rest, distinctOrgs: _orgs.size, distinctUsers: _users.size, distinctModels: _models.size }))
    .sort((x, y) => y.priceNanos - x.priceNanos);
}

function tokenUsage() {
  const to = new Date(NOW);
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const rows = mockUsageRows();
  const [totals] = groupUsage(rows, () => 'all', () => ({}));
  return {
    range: { from: iso(from), to: iso(to) },
    window: { from: iso(from), to: iso(to), label: 'Rolling 30 days (UTC)', timeZone: 'UTC' },
    pricing: { rule: 'price = provider cost × customer markup (same rule as Settings › Billing)', rateCardVerifiedAt: '2026-10-02' },
    health: { repricedEvents: 0, unpricedEvents: 0, unpricedModels: [], ok: true },
    totals,
    byCustomer: groupUsage(rows, (r) => r.orgId, (r) => ({ orgId: r.orgId, orgName: r.orgName })),
    byUser: groupUsage(rows, (r) => r.userId, (r) => ({ userId: r.userId, userName: r.userName, email: r.email, orgId: r.orgId, orgName: r.orgName })),
    byModel: groupUsage(rows, (r) => r.model, (r) => ({ model: r.model })),
    byFeature: groupUsage(rows, (r) => r.feature, (r) => ({ feature: r.feature })),
  };
}

function aiReconciliation() {
  const to = new Date(NOW);
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const day = (offset) => iso(new Date(to.getTime() - offset * 86_400_000)).slice(0, 10);
  const row = (offset, ours, theirs, pending = false) => {
    const varianceUsd = theirs == null ? null : Math.round((ours - theirs) * 1e6) / 1e6;
    const variancePct = theirs ? Math.round(((ours - theirs) / theirs) * 10_000) / 100 : null;
    const flagged = !pending && variancePct != null && Math.abs(variancePct) > 2;
    return { day: day(offset), oursUsd: ours, theirsUsd: theirs, varianceUsd, variancePct, flagged, pending };
  };
  const anthropicDays = [row(6, 0.4123, 0.4119), row(5, 0.3011, 0.3020), row(4, 0.2875, 0.3301), row(3, 0.5210, 0.5188), row(2, 0.1842, 0.1850), row(0, 0.0931, 0.0400, true)];
  const settled = anthropicDays.filter((d) => !d.pending);
  const oursSettled = settled.reduce((a, d) => a + d.oursUsd, 0);
  const theirsSettled = settled.reduce((a, d) => a + d.theirsUsd, 0);
  const totalPct = Math.round(((oursSettled - theirsSettled) / theirsSettled) * 10_000) / 100;
  const notConnected = (offsets) => offsets.map(([o, ours]) => row(o, ours, null));
  const total = (days) => ({ oursUsd: Math.round(days.reduce((a, d) => a + d.oursUsd, 0) * 1e6) / 1e6, theirsUsd: null, varianceUsd: null, variancePct: null, flagged: false });
  const googleDays = notConnected([[6, 0.0212], [4, 0.0187], [2, 0.0301], [1, 0.0094]]);
  const tavilyDays = notConnected([[5, 0.016], [3, 0.008], [1, 0.024]]);
  const providers = [
    {
      provider: 'anthropic', label: 'Anthropic (Claude)', status: 'connected', requires: [],
      source: 'Anthropic Admin API — Usage & Cost (cost_report)', error: null,
      note: 'TEST DATA. Covers every key in the Anthropic organization (or the one workspace you set).',
      days: anthropicDays,
      totals: {
        oursUsd: Math.round(oursSettled * 1e6) / 1e6,
        theirsUsd: Math.round(theirsSettled * 1e6) / 1e6,
        varianceUsd: Math.round((oursSettled - theirsSettled) * 1e6) / 1e6,
        variancePct: totalPct,
        flagged: Math.abs(totalPct) > 2,
      },
    },
    {
      provider: 'google', label: 'Google (Gemini API)', status: 'not_connected',
      requires: [
        'Cloud Billing → BigQuery export enabled (standard usage cost)',
        'GOOGLE_BILLING_EXPORT_TABLE (project.dataset.gcp_billing_export_v1_…)',
        'GOOGLE_BILLING_SERVICE_ACCOUNT_JSON (BigQuery Data Viewer + Job User; optional GOOGLE_BILLING_PROJECT_ID)',
      ],
      source: 'Cloud Billing export to BigQuery (service "Gemini API")', error: null,
      note: 'Billing export lags up to a day or more. Includes explicit context-cache storage and Google Search grounding fees.',
      days: googleDays, totals: total(googleDays),
    },
    {
      provider: 'openai', label: 'OpenAI (transcription)', status: 'not_connected',
      requires: ['OPENAI_ADMIN_KEY (organization admin key)'], source: 'OpenAI Costs API (organization/costs)',
      error: null, note: null, days: [], totals: total([]),
    },
    {
      provider: 'tavily', label: 'Tavily (web search)', status: 'unsupported',
      requires: ['Compare the monthly Tavily invoice by hand'], source: 'No per-day usage or cost API',
      error: null, note: 'Our side is provider-reported credits × $0.008 (pay-as-you-go).',
      days: tavilyDays, totals: total(tavilyDays),
    },
  ];
  return {
    generatedAt: iso(NOW),
    window: { from: iso(from), to: iso(to), timeZone: 'UTC' },
    thresholdPct: 2,
    flaggedCount: providers.reduce((a, p) => a + p.days.filter((d) => d.flagged).length + (p.totals.flagged ? 1 : 0), 0),
    providers,
  };
}

// ------------------------------------------------------- AI budgets (TEST DATA)
// Allowance = 10% of what the org pays; comp shows "comp"; unpaid shows $0.
function aiBudgets(includeInternal) {
  const month = { from: iso(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1))), to: iso(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1))) };
  const nextReset = month.to;
  const row = (orgId, orgName, billingClass, paidCents, source, aiCostUsd, extra = {}) => {
    const paying = billingClass === 'paying' || billingClass === 'past_due';
    const allowanceNanos = billingClass === 'comp' ? null : paying ? paidCents * 0.1 * 10_000_000 : 0;
    const aiCostNanos = Math.round(aiCostUsd * 1e9);
    return {
      orgId, orgName, internal: extra.internal ?? false, state: 'ok', paused: false,
      usedNanos: aiCostNanos, allowanceNanos: allowanceNanos ?? 0, usedFraction: 0, creditBalanceNanos: extra.credits ?? 0, resetAt: extra.resetAt ?? nextReset,
      staff: {
        billingClass, paidMonthlyCents: paying ? paidCents : 0, paidSource: paying ? source : null,
        allowanceMonthlyNanos: allowanceNanos,
        allowanceLabel: billingClass === 'comp' ? 'comp' : allowanceNanos ? `$${(allowanceNanos / 1e9).toFixed(2)}` : '$0',
        periodNote: extra.periodNote ?? null,
        displayResetAt: extra.periodNote ? null : (extra.resetAt ?? nextReset),
        usedOfAllowancePct: allowanceNanos ? Math.round((aiCostNanos / allowanceNanos) * 1000) / 10 : null,
        aiCostNanos, costWindow: month,
      },
    };
  };
  const budgets = [
    row('aaaaaaaa-0000-4000-8000-000000000001', 'Test Restoration Co (TEST DATA)', 'paying', 84_900, 'stripe', 31.42),
    row('aaaaaaaa-0000-4000-8000-000000000002', 'Sample Builders (TEST DATA)', 'paying', 70_750, 'stripe', 4.18),
    row('aaaaaaaa-0000-4000-8000-000000000003', 'Example Scale Group (TEST DATA)', 'paying', 224_900, 'catalog', 12.06, { credits: 25e9 }),
    row('aaaaaaaa-0000-4000-8000-000000000004', 'Mockley Mitigation (TEST DATA)', 'past_due', 39_900, 'stripe', 1.2, { periodNote: 'ended_awaiting_renewal', resetAt: iso(new Date(NOW.getTime() - 3 * DAY)) }),
    row('aaaaaaaa-0000-4000-8000-000000000005', 'Fixture Roofing (TEST DATA)', 'trialing', 0, null, 0.84),
  ];
  if (includeInternal) {
    budgets.push(row('aaaaaaaa-0000-4000-8000-0000000000c1', 'Internal Comp Org (TEST DATA)', 'comp', 0, null, 9.31, { internal: true, periodNote: 'no_reset_comp_term', resetAt: '2126-10-01T00:00:00.000Z' }));
  }
  return { budgets, includeInternal, allowanceFraction: 0.1, costWindow: { ...month, timeZone: 'UTC' } };
}

// ----------------------------------------------------------------- server
function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'x-atmosphere-test-data': '1',
  });
  res.end(status === 204 ? '' : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const USER = { id: '00000000-0000-4000-8000-00000000a11a', email: 'staff@example.test', createdAt: '2025-01-01T00:00:00.000Z' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const p = url.pathname;
  const m = req.method ?? 'GET';
  const signedOut = /(?:^|;\s*)mock_signed_out=1/.test(req.headers.cookie ?? '');

  if (p === '/api/auth/me') return signedOut ? send(res, 401, { error: 'Not authenticated', code: 'unauthorized' }) : send(res, 200, { user: USER });
  if (p === '/api/auth/internal-challenge' || p === '/api/auth/internal-login') return send(res, 200, { user: USER, challenge: null });
  if (p === '/api/auth/logout') return send(res, 200, { ok: true });
  if (p === '/api/ready') return send(res, 200, { ...demo.demoReady, time: iso(NOW) });

  if (!p.startsWith('/api/analytics/')) return send(res, 404, { error: 'Not in the mock API', code: 'mock_missing' });
  if (signedOut) return send(res, 401, { error: 'Not authenticated', code: 'unauthorized' });
  const r = p.slice('/api/analytics'.length);

  if (r === '/access') return send(res, 200, { scope: 'internal', displayName: 'Test Staff (TEST DATA)', pendingAccessRequests: 2 });
  const includeInternal = url.searchParams.get('internal') === '1';
  if (r === '/overview') return send(res, 200, overview(includeInternal));
  if (r === '/product-health') return send(res, 200, productHealth(Math.min(52, Math.max(4, Number(url.searchParams.get('weeks') ?? 12)))));
  if (r === '/experiments') return send(res, 200, { experiments: [], tracking: false, note: 'No experiments are instrumented.' });
  if (r === '/metering') return send(res, 200, demo.demoMetering);
  if (r === '/token-usage') return send(res, 200, tokenUsage());
  if (r === '/ai-reconciliation') return send(res, 200, aiReconciliation());
  if (r === '/ai-budgets') return send(res, 200, aiBudgets(includeInternal));
  if (r === '/access-requests') return send(res, 200, { requests: [], pendingCount: 0 });

  if (r === '/contacts') {
    return send(res, 200, {
      contacts,
      sources: [
        { id: 'stripe', label: 'Stripe', enabled: true, reason: null, count: contacts.length, truncated: false },
        { id: 'crm', label: 'CRM', enabled: false, reason: 'Coming soon. No CRM is connected.', count: null, truncated: false },
      ],
      fetchedAt: iso(NOW),
      cached: url.searchParams.get('refresh') !== '1',
      suppressedCount: suppressed.size,
    });
  }

  if (r === '/campaigns' && m === 'GET') {
    return send(res, 200, {
      campaigns: [...campaigns.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      suppressed: suppressed.size,
      sending: SENDING,
    });
  }
  if (r === '/campaigns' && m === 'POST') {
    const body = await readBody(req);
    return send(res, 201, { campaign: addCampaign({ ...body, name: body.name || 'Untitled campaign', ageDays: 0 }) });
  }
  if (r === '/campaigns/audience' && m === 'POST') {
    const body = await readBody(req);
    const matched = filterAudience(contacts, body.audience ?? {});
    const recipients = matched.filter((c) => !c.suppressed).length;
    return send(res, 200, { matched: matched.length, suppressed: matched.length - recipients, recipients, fetchedAt: iso(NOW) });
  }
  const match = /^\/campaigns\/([0-9a-f-]{36})(\/send)?$/.exec(r);
  if (match) {
    const row = campaigns.get(match[1]);
    if (!row) return send(res, 404, { error: 'Campaign not found.', code: 'campaign_not_found' });
    if (match[2]) {
      // Mirrors the real API with CAMPAIGN_SENDING_ENABLED unset. The mock cannot email anyone.
      return send(res, 403, { error: SENDING.reason, code: SENDING.code });
    }
    if (m === 'GET') return send(res, 200, { campaign: row, sending: SENDING });
    if (m === 'PUT') {
      const body = await readBody(req);
      Object.assign(row, {
        name: body.name || row.name,
        subject: body.subject ?? row.subject,
        bodyMarkdown: body.bodyMarkdown ?? row.bodyMarkdown,
        audience: body.audience ?? row.audience,
        updatedAt: iso(new Date()),
      });
      return send(res, 200, { campaign: row });
    }
    if (m === 'DELETE') {
      campaigns.delete(row.id);
      return send(res, 204, null);
    }
  }
  return send(res, 404, { error: 'Not in the mock API', code: 'mock_missing' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-api] TEST DATA on http://127.0.0.1:${PORT} (dev and screenshots only; never sends email)`);
});
