import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProductIntelligence } from './productInsights.js';
import type { AccountRow, FeatureRow, RetentionRow, SummaryPayload } from './analytics.js';

function feature(partial: Partial<FeatureRow> & Pick<FeatureRow, 'featureKey' | 'label' | 'area'>): FeatureRow {
  return {
    sessions: 0,
    activeMs: 0,
    activeHours: 0,
    users: 0,
    orgs: 0,
    avgSessionMinutes: 0,
    sharePct: 0,
    timeRank: 99,
    aiRequests: 0,
    lastUsedAt: null,
    ...partial,
  };
}

function summary(overrides: Partial<SummaryPayload['engagement']> = {}): SummaryPayload {
  return {
    scope: 'internal',
    range: { from: '2026-01-01', to: '2026-07-01', days: 181 },
    customers: {
      orgsTotal: 20,
      orgsNew: 4,
      orgsPaying: 8,
      orgsActive: 12,
      orgsGrowthMomPct: 5,
    },
    users: { usersTotal: 40, usersNew: 6, usersActive: 22, usersGrowthMomPct: 3 },
    seats: {
      seatsLicensed: 50,
      seatsFilled: 40,
      seatUtilizationPct: 80,
      seatsGrowthMomPct: 2,
    },
    revenue: {
      mrrCents: 100_000,
      arrCents: 1_200_000,
      annualContractedMrrCents: 0,
      annualContractedArrCents: 0,
      monthlyBilledMrrCents: 100_000,
      trialPipelineMrrCents: 0,
      mrrGrowthMomPct: 4,
      netNewMrrCents: 5_000,
      collectedInRangeCents: 500_000,
      subscriptionRevenueCents: 400_000,
      creditRevenueCents: 100_000,
      trailing12mRevenueCents: 1_000_000,
      avgMonthlySpendPerAccountCents: 12_500,
      avgMonthlySpendPerSeatCents: 2_000,
      arpaMrrCents: 12_500,
    },
    engagement: {
      trackedHours: 80,
      sessions: 200,
      featuresUsed: 4,
      featuresTracked: 10,
      aiRequests: 50,
      ...overrides,
    },
  };
}

describe('product intelligence: areas and ranking', () => {
  it('rolls areas by hours and lists hottest / coldest', () => {
    const features = [
      feature({
        featureKey: 'jobs',
        label: 'Jobs',
        area: 'Field ops',
        activeHours: 40,
        sharePct: 50,
        timeRank: 1,
        users: 10,
        orgs: 6,
        sessions: 40,
      }),
      feature({
        featureKey: 'dashboard',
        label: 'Team dashboard',
        area: 'Platform',
        activeHours: 30,
        sharePct: 37.5,
        timeRank: 2,
        users: 20,
        orgs: 10,
        sessions: 80,
      }),
      feature({
        featureKey: 'computer_use',
        label: 'Computer use',
        area: 'Automation',
        activeHours: 0,
        sharePct: 0,
        timeRank: 3,
      }),
      feature({
        featureKey: 'web_verification',
        label: 'Run verification',
        area: 'Automation',
        activeHours: 0,
        sharePct: 0,
        timeRank: 4,
      }),
    ];

    const intel = buildProductIntelligence({
      features,
      accounts: [],
      retention: [],
      summary: summary(),
    });

    assert.equal(intel.areas[0]?.area, 'Field ops');
    assert.equal(intel.hottest[0]?.featureKey, 'jobs');
    assert.equal(intel.coldest[0]?.activeHours, 0);
    assert.equal(intel.confidence, 'high');
  });
});

describe('product intelligence: cut / invest / stickiness', () => {
  it('flags unused non-core tools as cut candidates', () => {
    const features = [
      feature({
        featureKey: 'dashboard',
        label: 'Team dashboard',
        area: 'Platform',
        activeHours: 10,
        sharePct: 100,
        timeRank: 1,
        users: 5,
        orgs: 3,
        sessions: 10,
      }),
      feature({ featureKey: 'computer_use', label: 'Computer use', area: 'Automation' }),
      feature({ featureKey: 'web_verification', label: 'Run verification', area: 'Automation' }),
      feature({
        featureKey: 'construction_estimator',
        label: 'Construction estimator',
        area: 'Estimating',
      }),
    ];

    const intel = buildProductIntelligence({
      features,
      accounts: [],
      retention: [],
      summary: summary({ trackedHours: 10, featuresUsed: 1, featuresTracked: 4 }),
    });

    assert.ok(intel.insights.some((i) => i.kind === 'cut'));
    assert.ok(
      intel.insights.some((i) => i.featureKeys.includes('computer_use')),
      'unused automation tools should appear in cut advice',
    );
    // Core dashboard must never be a cut target.
    assert.ok(!intel.insights.some((i) => i.kind === 'cut' && i.featureKeys.length === 1 && i.featureKeys[0] === 'dashboard'));
  });

  it('recommends investing in the hottest tools', () => {
    const features = [
      feature({
        featureKey: 'mitigation_estimator',
        label: 'Mitigation estimator',
        area: 'Estimating',
        activeHours: 50,
        sharePct: 60,
        timeRank: 1,
        users: 12,
        orgs: 7,
        sessions: 30,
        avgSessionMinutes: 12,
      }),
      feature({
        featureKey: 'jobs',
        label: 'Jobs',
        area: 'Field ops',
        activeHours: 20,
        sharePct: 25,
        timeRank: 2,
        users: 8,
        orgs: 5,
        sessions: 20,
      }),
      feature({
        featureKey: 'settings',
        label: 'Settings',
        area: 'Platform',
        activeHours: 1,
        sharePct: 1,
        timeRank: 3,
        users: 2,
        orgs: 2,
        sessions: 4,
      }),
    ];

    const accounts: AccountRow[] = [
      {
        orgId: '1',
        orgName: 'Acme',
        createdAt: '2026-01-01',
        planCode: 'pro',
        planName: 'Pro',
        billingInterval: 'monthly',
        status: 'active',
        seats: 5,
        members: 4,
        mrrCents: 20_000,
        arrCents: 240_000,
        revenueInRangeCents: 60_000,
        creditSpendCents: 0,
        activeHours: 15,
        topFeature: 'Mitigation estimator',
        lastActiveAt: '2026-07-01',
      },
    ];

    const intel = buildProductIntelligence({
      features,
      accounts,
      retention: [],
      summary: summary(),
    });

    const invest = intel.insights.filter((i) => i.kind === 'invest');
    assert.ok(invest.some((i) => i.featureKeys.includes('mitigation_estimator')));
    assert.equal(invest[0]?.priority, 'high');
  });

  it('flags dashboard dominance and soft M1 retention as stickiness plays', () => {
    const features = [
      feature({
        featureKey: 'dashboard',
        label: 'Team dashboard',
        area: 'Platform',
        activeHours: 60,
        sharePct: 70,
        timeRank: 1,
        users: 20,
        orgs: 10,
        sessions: 100,
        avgSessionMinutes: 3,
      }),
      feature({
        featureKey: 'jobs',
        label: 'Jobs',
        area: 'Field ops',
        activeHours: 20,
        sharePct: 20,
        timeRank: 2,
        users: 8,
        orgs: 5,
        sessions: 20,
        avgSessionMinutes: 8,
      }),
      feature({
        featureKey: 'memory',
        label: 'Agent memory',
        area: 'Field ops',
        activeHours: 5,
        sharePct: 5,
        timeRank: 3,
        users: 3,
        orgs: 2,
        sessions: 10,
        avgSessionMinutes: 1.2,
      }),
    ];

    const retention: RetentionRow[] = [
      {
        cohortMonth: '2026-01-01',
        cohortSize: 10,
        monthOffset: 1,
        activeOrgs: 3,
        retentionPct: 30,
      },
      {
        cohortMonth: '2026-02-01',
        cohortSize: 8,
        monthOffset: 1,
        activeOrgs: 2,
        retentionPct: 25,
      },
    ];

    const intel = buildProductIntelligence({
      features,
      accounts: [],
      retention,
      summary: summary({ featuresUsed: 3, featuresTracked: 3 }),
    });

    assert.ok(intel.insights.some((i) => i.id === 'stickiness-dashboard-trap'));
    assert.ok(intel.insights.some((i) => i.id === 'stickiness-m1-retention'));
    assert.ok(intel.insights.some((i) => i.kind === 'stickiness' && i.action.length > 20));
  });

  it('marks confidence low when there is almost no telemetry', () => {
    const intel = buildProductIntelligence({
      features: [feature({ featureKey: 'dashboard', label: 'Team dashboard', area: 'Platform' })],
      accounts: null,
      retention: [],
      summary: summary({ trackedHours: 0, sessions: 0, featuresUsed: 0, featuresTracked: 1 }),
    });
    assert.equal(intel.confidence, 'low');
    assert.match(intel.confidenceNote, /No product telemetry|hypothesis|hours/i);
  });
});
