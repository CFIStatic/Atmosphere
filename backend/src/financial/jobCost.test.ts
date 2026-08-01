import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCents, rollupJobCosts, totalCashCents } from './jobCost.js';
import { evaluateRules } from './rules.js';
import type {
  AutomationSettings,
  FinanceAccount,
  FinanceConnection,
  FinanceSnapshot,
  JobCost,
  JobMoney,
} from './types.js';

const settings: AutomationSettings = {
  orgId: 'org',
  enabled: true,
  timezone: 'America/New_York',
  digestHour: 7,
  arWarnDays: 30,
  arCriticalDays: 45,
  marginFloorPct: 15,
  overBudgetPct: 100,
  unbilledCostWarnCents: 500_000,
  cashFloorCents: 1_000_000,
  connectionStaleHours: 48,
  booksBalanceToleranceCents: 10_000,
  defaultLaborRateCents: 6_500,
  disabledRules: [],
  updatedAt: new Date().toISOString(),
};

describe('financial job costing', () => {
  it('formats cents as dollars', () => {
    assert.equal(formatCents(123456), '$1,234.56');
    assert.equal(formatCents(-50), '-$0.50');
  });

  it('rolls up posted costs and implies labor from work logs', () => {
    const jobs: JobMoney[] = [
      {
        id: 'j1',
        orgId: 'org',
        jobNumber: 12,
        title: 'Elm St',
        status: 'in_progress',
        workType: 'mitigation',
        contractCents: 100_000_00,
        invoicedCents: 40_000_00,
        paidCents: 10_000_00,
        openArCents: 30_000_00,
        agingAnchor: new Date(Date.now() - 50 * 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];
    const costs: JobCost[] = [
      {
        id: 'c1',
        orgId: 'org',
        jobId: 'j1',
        pmProjectId: null,
        costCodeId: null,
        category: 'materials',
        description: 'Drywall',
        quantity: 1,
        unit: 'EA',
        unitCostCents: 20_000_00,
        amountCents: 20_000_00,
        incurredOn: '2026-07-01',
        origin: 'manual',
        sourceTable: null,
        sourceId: null,
        agentRunId: null,
        status: 'posted',
        createdBy: 'u',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const labor = new Map([['j1', 600]]); // 10 hours
    const rollups = rollupJobCosts(jobs, costs, labor, settings);
    assert.equal(rollups.length, 1);
    assert.equal(rollups[0].materialsCents, 20_000_00);
    assert.equal(rollups[0].laborCents, 10 * 6_500);
    assert.equal(rollups[0].costCents, 20_000_00 + 65_000);
    assert.ok(rollups[0].marginPct !== null && rollups[0].marginPct! > 70);
  });

  it('sums bank cash only', () => {
    const accounts: FinanceAccount[] = [
      {
        id: 'a1',
        orgId: 'org',
        connectionId: null,
        name: 'Checking',
        accountType: 'checking',
        currency: 'USD',
        balanceCents: 500_000,
        balanceAsOf: null,
        externalId: null,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'a2',
        orgId: 'org',
        connectionId: null,
        name: 'AR',
        accountType: 'accounts_receivable',
        currency: 'USD',
        balanceCents: 9_000_000,
        balanceAsOf: null,
        externalId: null,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
    ];
    assert.equal(totalCashCents(accounts), 500_000);
  });
});

describe('financial rules', () => {
  it('flags critical AR and low cash', () => {
    const now = new Date();
    const snapshot: FinanceSnapshot = {
      orgId: 'org',
      now,
      settings,
      connections: [] as FinanceConnection[],
      accounts: [
        {
          id: 'a1',
          orgId: 'org',
          connectionId: null,
          name: 'Checking',
          accountType: 'checking',
          currency: 'USD',
          balanceCents: 100_000,
          balanceAsOf: now.toISOString(),
          externalId: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      jobs: [],
      rollups: [
        {
          jobId: 'j1',
          title: 'Elm St',
          jobNumber: 1,
          contractCents: 50_000_00,
          invoicedCents: 50_000_00,
          paidCents: 0,
          openArCents: 50_000_00,
          costCents: 10_000_00,
          laborCents: 10_000_00,
          materialsCents: 0,
          equipmentCents: 0,
          subcontractCents: 0,
          otherCents: 0,
          marginCents: 40_000_00,
          marginPct: 80,
          agingDays: 50,
        },
      ],
      costCodes: [],
    };

    const { findings } = evaluateRules(snapshot);
    const keys = findings.map((f) => f.ruleKey);
    assert.ok(keys.includes('ar_aging_critical'));
    assert.ok(keys.includes('cash_low'));
  });
});
