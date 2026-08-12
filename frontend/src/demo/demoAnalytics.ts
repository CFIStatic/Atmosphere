/**
 * Demo fixtures for the Beta Portal — plausible 18-month growth history so
 * Board / Growth / Customers / Models / Product all render with real shape.
 */

import type {
  MeteringAnalytics,
  OverviewPayload,
  ProductIntelligence,
} from '../lib/analyticsApi';

function monthKey(monthsAgo: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function buildMonthly() {
  const rows = [];
  // Cents: start at $18,400 MRR and compound upward.
  let mrr = 1_840_000;
  let orgs = 6;
  let users = 28;
  let seats = 42;

  for (let ago = 17; ago >= 0; ago--) {
    // Steady SaaS curve — believable for a board deck (~3–6% MoM).
    const growth = ago > 12 ? 0.035 : ago > 6 ? 0.045 : 0.055;
    const prevMrr = mrr;
    mrr = Math.round(mrr * (1 + growth));
    orgs += ago % 4 === 0 ? 2 : 1;
    users = Math.round(users * (1 + growth * 0.85));
    seats = Math.round(seats * (1 + growth * 0.75));
    const paying = Math.max(3, orgs - 2);
    const revenue = Math.round(mrr * 1.12);
    rows.push({
      month: monthKey(ago),
      newOrgs: ago % 4 === 0 ? 2 : 1,
      totalOrgs: orgs,
      payingOrgs: paying,
      activeOrgs: Math.max(paying - 1, paying),
      churnedOrgs: ago === 1 ? 1 : 0,
      newUsers: Math.round(users * 0.06),
      totalUsers: users,
      activeUsers: Math.round(users * 0.74),
      seats,
      mrrCents: mrr,
      arrCents: mrr * 12,
      revenueCents: revenue,
      subscriptionRevenueCents: Math.round(revenue * 0.85),
      creditRevenueCents: Math.round(revenue * 0.15),
      arpaCents: Math.round(mrr / paying),
      mrrGrowthPct: ago === 17 ? null : Number((((mrr - prevMrr) / prevMrr) * 100).toFixed(1)),
      userGrowthPct: ago === 17 ? null : Number((growth * 85).toFixed(1)),
      seatGrowthPct: ago === 17 ? null : Number((growth * 75).toFixed(1)),
      trackedHours: Math.round(120 + (17 - ago) * 32 + (ago % 4) * 10),
    });
  }
  return rows;
}

const monthly = buildMonthly();
const latest = monthly[monthly.length - 1];

const features = [
  {
    featureKey: 'web_runs',
    label: 'Web runs',
    area: 'automation',
    sessions: 1842,
    activeMs: 48_600_000 * 34,
    activeHours: 459,
    users: 86,
    orgs: 22,
    avgSessionMinutes: 14.2,
    sharePct: 34,
    timeRank: 1,
    aiRequests: 4200,
    lastUsedAt: new Date().toISOString(),
  },
  {
    featureKey: 'agent_console',
    label: 'Agent console',
    area: 'automation',
    sessions: 920,
    activeMs: 48_600_000 * 18,
    activeHours: 243,
    users: 54,
    orgs: 18,
    avgSessionMinutes: 11.5,
    sharePct: 18,
    timeRank: 2,
    aiRequests: 3100,
    lastUsedAt: new Date().toISOString(),
  },
  {
    featureKey: 'dashboard',
    label: 'Dashboard',
    area: 'core',
    sessions: 2100,
    activeMs: 48_600_000 * 14,
    activeHours: 189,
    users: 110,
    orgs: 24,
    avgSessionMinutes: 4.1,
    sharePct: 14,
    timeRank: 3,
    aiRequests: 120,
    lastUsedAt: new Date().toISOString(),
  },
  {
    featureKey: 'web_connections',
    label: 'Web connections',
    area: 'integrations',
    sessions: 410,
    activeMs: 48_600_000 * 11,
    activeHours: 148.5,
    users: 32,
    orgs: 14,
    avgSessionMinutes: 8.4,
    sharePct: 11,
    timeRank: 4,
    aiRequests: 40,
    lastUsedAt: new Date().toISOString(),
  },
  {
    featureKey: 'web_verification',
    label: 'Verification',
    area: 'verification',
    sessions: 680,
    activeMs: 48_600_000 * 9,
    activeHours: 121.5,
    users: 48,
    orgs: 16,
    avgSessionMinutes: 9.8,
    sharePct: 9,
    timeRank: 5,
    aiRequests: 890,
    lastUsedAt: new Date().toISOString(),
  },
  {
    featureKey: 'billing_console',
    label: 'Billing',
    area: 'admin',
    sessions: 95,
    activeMs: 48_600_000 * 4,
    activeHours: 54,
    users: 18,
    orgs: 12,
    avgSessionMinutes: 3.2,
    sharePct: 4,
    timeRank: 6,
    aiRequests: 0,
    lastUsedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    featureKey: 'ai_assistant',
    label: 'AI assistant',
    area: 'automation',
    sessions: 0,
    activeMs: 0,
    activeHours: 0,
    users: 0,
    orgs: 0,
    avgSessionMinutes: 0,
    sharePct: 0,
    timeRank: 7,
    aiRequests: 0,
    lastUsedAt: null,
  },
  {
    featureKey: 'pin_signin',
    label: 'PIN sign-in',
    area: 'auth',
    sessions: 0,
    activeMs: 0,
    activeHours: 0,
    users: 0,
    orgs: 0,
    avgSessionMinutes: 0,
    sharePct: 0,
    timeRank: 8,
    aiRequests: 0,
    lastUsedAt: null,
  },
];

const accounts = [
  {
    orgId: 'org-northwind',
    orgName: 'Northwind Restoration',
    createdAt: monthKey(17),
    planCode: 'team',
    planName: 'Team',
    billingInterval: 'annual',
    status: 'active',
    seats: 12,
    members: 9,
    mrrCents: 300_000,
    arrCents: 3_600_000,
    revenueInRangeCents: 3_850_000,
    creditSpendCents: 420_000,
    activeHours: 186,
    topFeature: 'Web runs',
    lastActiveAt: new Date().toISOString(),
  },
  {
    orgId: 'org-ironclad',
    orgName: 'Ironclad Construction',
    createdAt: monthKey(7),
    planCode: 'team',
    planName: 'Team',
    billingInterval: 'annual',
    status: 'active',
    seats: 25,
    members: 21,
    mrrCents: 625_000,
    arrCents: 7_500_000,
    revenueInRangeCents: 7_900_000,
    creditSpendCents: 980_000,
    activeHours: 312,
    topFeature: 'Agent console',
    lastActiveAt: new Date().toISOString(),
  },
  {
    orgId: 'org-harbor',
    orgName: 'Harbor Mitigation Co',
    createdAt: monthKey(15),
    planCode: 'team',
    planName: 'Team',
    billingInterval: 'annual',
    status: 'active',
    seats: 8,
    members: 7,
    mrrCents: 200_000,
    arrCents: 2_400_000,
    revenueInRangeCents: 2_550_000,
    creditSpendCents: 210_000,
    activeHours: 142,
    topFeature: 'Verification',
    lastActiveAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    orgId: 'org-gulf',
    orgName: 'Gulf Coast Drying',
    createdAt: monthKey(11),
    planCode: 'max_5x',
    planName: 'Max 5×',
    billingInterval: 'monthly',
    status: 'active',
    seats: 1,
    members: 4,
    mrrCents: 100_000,
    arrCents: 1_200_000,
    revenueInRangeCents: 1_480_000,
    creditSpendCents: 640_000,
    activeHours: 98,
    topFeature: 'Web runs',
    lastActiveAt: new Date().toISOString(),
  },
  {
    orgId: 'org-pinnacle',
    orgName: 'Pinnacle Remediation',
    createdAt: monthKey(5),
    planCode: 'max_20x',
    planName: 'Max 20×',
    billingInterval: 'annual',
    status: 'active',
    seats: 1,
    members: 6,
    mrrCents: 200_000,
    arrCents: 2_400_000,
    revenueInRangeCents: 2_900_000,
    creditSpendCents: 1_120_000,
    activeHours: 167,
    topFeature: 'Agent console',
    lastActiveAt: new Date().toISOString(),
  },
  {
    orgId: 'org-lakeshore',
    orgName: 'Lakeshore Property Care',
    createdAt: monthKey(6),
    planCode: 'pro',
    planName: 'Pro',
    billingInterval: 'monthly',
    status: 'canceled',
    seats: 1,
    members: 2,
    mrrCents: 0,
    arrCents: 0,
    revenueInRangeCents: 84_000,
    creditSpendCents: 12_000,
    activeHours: 4,
    topFeature: 'Dashboard',
    lastActiveAt: new Date(Date.now() - 40 * 86400000).toISOString(),
  },
  {
    orgId: 'org-copper',
    orgName: 'Copper Peak Mitigation',
    createdAt: monthKey(1),
    planCode: 'team',
    planName: 'Team',
    billingInterval: 'monthly',
    status: 'active',
    seats: 5,
    members: 5,
    mrrCents: 150_000,
    arrCents: 1_800_000,
    revenueInRangeCents: 210_000,
    creditSpendCents: 38_000,
    activeHours: 41,
    topFeature: 'Dashboard',
    lastActiveAt: new Date().toISOString(),
  },
];

const productIntelligence: ProductIntelligence = {
  confidence: 'high',
  confidenceNote: '18 months of tracked foreground time across paying accounts.',
  areas: [
    { area: 'automation', activeHours: 702, sharePct: 52, featuresUsed: 2, featuresTracked: 3, sessions: 2762, peakUsers: 86 },
    { area: 'core', activeHours: 189, sharePct: 14, featuresUsed: 1, featuresTracked: 1, sessions: 2100, peakUsers: 110 },
    { area: 'integrations', activeHours: 148.5, sharePct: 11, featuresUsed: 1, featuresTracked: 1, sessions: 410, peakUsers: 32 },
    { area: 'verification', activeHours: 121.5, sharePct: 9, featuresUsed: 1, featuresTracked: 1, sessions: 680, peakUsers: 48 },
    { area: 'admin', activeHours: 54, sharePct: 4, featuresUsed: 1, featuresTracked: 1, sessions: 95, peakUsers: 18 },
  ],
  hottest: features.slice(0, 3),
  coldest: features.slice(-2),
  insights: [
    {
      id: 'cut-ai-assistant',
      kind: 'cut',
      priority: 'high',
      title: 'AI assistant has zero adoption',
      rationale: 'Instrumented for 6+ months with no foreground sessions across paying orgs.',
      action: 'Hide from nav or fold into Agent console; stop spending design cycles here.',
      featureKeys: ['ai_assistant'],
      area: 'automation',
      metrics: { activeHours: 0, orgs: 0 },
    },
    {
      id: 'invest-web-runs',
      kind: 'invest',
      priority: 'high',
      title: 'Web runs dominate product time',
      rationale: '34% of all tracked hours; strongest correlation with seat expansion.',
      action: 'Double down on run reliability, templates, and sharing — this is the wedge.',
      featureKeys: ['web_runs'],
      area: 'automation',
      metrics: { sharePct: 34, orgs: 22 },
    },
    {
      id: 'stick-verification',
      kind: 'stickiness',
      priority: 'medium',
      title: 'Verification is the retention hook',
      rationale: 'Orgs that hit verification weekly churn ~40% less than dashboard-only accounts.',
      action: 'Surface verification earlier in onboarding and job completion flows.',
      featureKeys: ['web_verification'],
      area: 'verification',
      metrics: { activeHours: 121.5 },
    },
  ],
};

export function demoAnalyticsOverview(): OverviewPayload {
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - 12);
  return {
    scope: 'internal',
    generatedAt: new Date().toISOString(),
    range: { from: from.toISOString(), to: new Date().toISOString() },
    summary: {
      scope: 'internal',
      range: { from: from.toISOString(), to: new Date().toISOString(), days: 365 },
      customers: {
        orgsTotal: latest.totalOrgs,
        orgsNew: 4,
        orgsPaying: latest.payingOrgs,
        orgsActive: latest.activeOrgs,
        orgsGrowthMomPct: 4.2,
      },
      users: {
        usersTotal: latest.totalUsers,
        usersNew: latest.newUsers,
        usersActive: latest.activeUsers,
        usersGrowthMomPct: 3.8,
      },
      seats: {
        seatsLicensed: latest.seats,
        seatsFilled: Math.round(latest.seats * 0.78),
        seatUtilizationPct: 78,
        seatsGrowthMomPct: 3.5,
      },
      revenue: {
        mrrCents: latest.mrrCents,
        arrCents: latest.arrCents,
        annualContractedMrrCents: Math.round(latest.mrrCents * 0.62),
        annualContractedArrCents: Math.round(latest.arrCents * 0.62),
        monthlyBilledMrrCents: Math.round(latest.mrrCents * 0.38),
        trialPipelineMrrCents: 48_000,
        mrrGrowthMomPct: latest.mrrGrowthPct,
        netNewMrrCents: Math.round(
          latest.mrrCents - (monthly[monthly.length - 2]?.mrrCents ?? latest.mrrCents),
        ),
        collectedInRangeCents: monthly.reduce((s, m) => s + m.revenueCents, 0),
        subscriptionRevenueCents: monthly.reduce((s, m) => s + m.subscriptionRevenueCents, 0),
        creditRevenueCents: monthly.reduce((s, m) => s + m.creditRevenueCents, 0),
        trailing12mRevenueCents: monthly.slice(-12).reduce((s, m) => s + m.revenueCents, 0),
        avgMonthlySpendPerAccountCents: Math.round(latest.mrrCents / latest.payingOrgs),
        avgMonthlySpendPerSeatCents: Math.round(latest.mrrCents / latest.seats),
        arpaMrrCents: latest.arpaCents,
      },
      engagement: {
        trackedHours: features.reduce((s, f) => s + f.activeHours, 0),
        sessions: features.reduce((s, f) => s + f.sessions, 0),
        featuresUsed: features.filter((f) => f.activeHours > 0).length,
        featuresTracked: features.length,
        aiRequests: features.reduce((s, f) => s + f.aiRequests, 0),
      },
      unitEconomics: {
        billedUsageCents: 1_840_000,
        modelCostCents: 620_000,
        grossMarginCents: 1_220_000,
        grossMarginPct: 66.3,
      },
    },
    monthly,
    features,
    planMix: [
      {
        planCode: 'team',
        planName: 'Team',
        billingInterval: 'annual',
        orgs: 4,
        seats: 50,
        mrrCents: Math.round(latest.mrrCents * 0.48),
        arrCents: Math.round(latest.arrCents * 0.48),
        mrrSharePct: 48,
      },
      {
        planCode: 'team',
        planName: 'Team',
        billingInterval: 'monthly',
        orgs: 3,
        seats: 29,
        mrrCents: Math.round(latest.mrrCents * 0.22),
        arrCents: Math.round(latest.arrCents * 0.22),
        mrrSharePct: 22,
      },
      {
        planCode: 'max_20x',
        planName: 'Max 20×',
        billingInterval: 'annual',
        orgs: 1,
        seats: 1,
        mrrCents: Math.round(latest.mrrCents * 0.12),
        arrCents: Math.round(latest.arrCents * 0.12),
        mrrSharePct: 12,
      },
      {
        planCode: 'max_5x',
        planName: 'Max 5×',
        billingInterval: 'monthly',
        orgs: 1,
        seats: 1,
        mrrCents: Math.round(latest.mrrCents * 0.08),
        arrCents: Math.round(latest.arrCents * 0.08),
        mrrSharePct: 8,
      },
      {
        planCode: 'pro',
        planName: 'Pro',
        billingInterval: 'monthly',
        orgs: 4,
        seats: 4,
        mrrCents: Math.round(latest.mrrCents * 0.1),
        arrCents: Math.round(latest.arrCents * 0.1),
        mrrSharePct: 10,
      },
    ],
    retention: (() => {
      const rows = [];
      for (let c = 11; c >= 0; c--) {
        const size = 2 + ((11 - c) % 3);
        for (let offset = 0; offset <= Math.min(6, c); offset++) {
          const retained = Math.max(1, Math.round(size * (1 - offset * 0.12)));
          rows.push({
            cohortMonth: monthKey(c),
            cohortSize: size,
            monthOffset: offset,
            activeOrgs: retained,
            retentionPct: (retained / size) * 100,
          });
        }
      }
      return rows;
    })(),
    accounts,
    productIntelligence,
  };
}

export function demoMeteringAnalytics(): MeteringAnalytics {
  return {
    totals: {
      eventCount: 48_220,
      aiCostNanos: 6_200_000_000_000, // $6,200
      computeUnits: 182_400,
      distinctOrgs: 18,
    },
    byModel: [
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514', eventCount: 22_100, aiCostNanos: 2_800_000_000_000 },
      { provider: 'anthropic', model: 'claude-opus-4-20250514', eventCount: 4_200, aiCostNanos: 1_900_000_000_000 },
      { provider: 'openai', model: 'gpt-4.1', eventCount: 9_800, aiCostNanos: 980_000_000_000 },
      { provider: 'google', model: 'gemini-2.5-pro', eventCount: 6_400, aiCostNanos: 320_000_000_000 },
      { provider: 'anthropic', model: 'claude-haiku-4-20250514', eventCount: 5_720, aiCostNanos: 200_000_000_000 },
    ],
    byCustomer: [
      {
        orgId: 'org-ironclad',
        orgName: 'Ironclad Construction',
        eventCount: 12_400,
        aiCostNanos: 1_850_000_000_000,
        computeUnits: 52_000,
        distinctJobs: 48,
      },
      {
        orgId: 'org-pinnacle',
        orgName: 'Pinnacle Remediation',
        eventCount: 9_100,
        aiCostNanos: 1_420_000_000_000,
        computeUnits: 41_200,
        distinctJobs: 31,
      },
      {
        orgId: 'org-northwind',
        orgName: 'Northwind Restoration',
        eventCount: 7_800,
        aiCostNanos: 980_000_000_000,
        computeUnits: 28_400,
        distinctJobs: 36,
      },
      {
        orgId: 'org-gulf',
        orgName: 'Gulf Coast Drying',
        eventCount: 5_200,
        aiCostNanos: 640_000_000_000,
        computeUnits: 19_100,
        distinctJobs: 22,
      },
    ],
    byWorkflow: [
      { workflowId: 'scope-extract', eventCount: 14_200, aiCostNanos: 1_600_000_000_000 },
      { workflowId: 'verifier-review', eventCount: 11_800, aiCostNanos: 1_450_000_000_000 },
      { workflowId: 'estimate-assist', eventCount: 8_400, aiCostNanos: 920_000_000_000 },
      { workflowId: 'job-summary', eventCount: 6_100, aiCostNanos: 410_000_000_000 },
    ],
    byAgent: [
      { agentType: 'verifier', eventCount: 16_400, aiCostNanos: 2_100_000_000_000 },
      { agentType: 'estimator', eventCount: 12_200, aiCostNanos: 1_700_000_000_000 },
      { agentType: 'sales', eventCount: 7_800, aiCostNanos: 880_000_000_000 },
      { agentType: 'pm', eventCount: 5_400, aiCostNanos: 520_000_000_000 },
    ],
  };
}

export const demoExperiments = {
  experiments: [
    {
      experimentKey: 'onboarding_cta_v2',
      name: 'Onboarding CTA copy',
      status: 'running',
      description: '“Start verification” vs “Film the day” on the first-run card.',
      variants: [
        {
          variantKey: 'control',
          label: 'Start verification',
          weight: 50,
          assignments: 420,
          exposures: 390,
          conversions: 118,
          events: 118,
        },
        {
          variantKey: 'film',
          label: 'Film the day',
          weight: 50,
          assignments: 415,
          exposures: 402,
          conversions: 151,
          events: 151,
        },
      ],
    },
  ],
};
