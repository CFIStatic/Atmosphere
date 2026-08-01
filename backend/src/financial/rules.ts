import { formatCents, totalCashCents } from './jobCost.js';
import type { Finding, FinanceSnapshot, Rule } from './types.js';

/**
 * Pure financial health rules.
 *
 * Fingerprints are stable (no counts, no timestamps). suggestedAction always
 * names the next move for the CEO / CFO / accountant.
 */

const jobLabel = (r: { jobNumber: number | null; title: string }) =>
  r.jobNumber != null ? `Job #${r.jobNumber} · ${r.title}` : r.title;

const arAgingCritical: Rule = {
  key: 'ar_aging_critical',
  label: 'Critical AR aging',
  description: 'Open receivables have aged past the critical threshold.',
  category: 'ar',
  evaluate({ settings, rollups }) {
    return rollups
      .filter(
        (r) =>
          r.openArCents > 0 &&
          r.agingDays !== null &&
          r.agingDays >= settings.arCriticalDays,
      )
      .map(
        (r) =>
          ({
            ruleKey: 'ar_aging_critical',
            fingerprint: `ar_aging_critical:${r.jobId}`,
            severity: 'critical',
            category: 'ar',
            title: `${jobLabel(r)} — AR past ${settings.arCriticalDays} days`,
            detail: `${formatCents(r.openArCents)} open for ${r.agingDays} days (invoiced ${formatCents(r.invoicedCents)}, paid ${formatCents(r.paidCents)}).`,
            suggestedAction:
              'Call the carrier or customer today, and escalate anything past 60 days to collections.',
            jobId: r.jobId,
            entityType: 'crm_jobs',
            entityId: r.jobId,
            facts: {
              openArCents: r.openArCents,
              agingDays: r.agingDays,
              threshold: settings.arCriticalDays,
            },
          }) satisfies Finding,
      );
  },
};

const arAgingWarn: Rule = {
  key: 'ar_aging_warn',
  label: 'AR aging warning',
  description: 'Open receivables have aged past the warn threshold but not yet critical.',
  category: 'ar',
  evaluate({ settings, rollups }) {
    return rollups
      .filter(
        (r) =>
          r.openArCents > 0 &&
          r.agingDays !== null &&
          r.agingDays >= settings.arWarnDays &&
          r.agingDays < settings.arCriticalDays,
      )
      .map(
        (r) =>
          ({
            ruleKey: 'ar_aging_warn',
            fingerprint: `ar_aging_warn:${r.jobId}`,
            severity: 'warn',
            category: 'ar',
            title: `${jobLabel(r)} — AR past ${settings.arWarnDays} days`,
            detail: `${formatCents(r.openArCents)} open for ${r.agingDays} days.`,
            suggestedAction: 'Send a payment reminder and confirm the adjuster has everything needed.',
            jobId: r.jobId,
            entityType: 'crm_jobs',
            entityId: r.jobId,
            facts: {
              openArCents: r.openArCents,
              agingDays: r.agingDays,
              threshold: settings.arWarnDays,
            },
          }) satisfies Finding,
      );
  },
};

const jobOverBudget: Rule = {
  key: 'job_over_budget',
  label: 'Job over budget',
  description: 'Posted and implied cost has reached or exceeded the contract amount threshold.',
  category: 'job_cost',
  evaluate({ settings, rollups }) {
    return rollups
      .filter((r) => {
        if (r.contractCents === null || r.contractCents <= 0) return false;
        const ceiling = (r.contractCents * settings.overBudgetPct) / 100;
        return r.costCents >= ceiling;
      })
      .map((r) => {
        const pct = r.contractCents
          ? Math.round((r.costCents / r.contractCents) * 1000) / 10
          : 0;
        return {
          ruleKey: 'job_over_budget',
          fingerprint: `job_over_budget:${r.jobId}`,
          severity: 'critical',
          category: 'job_cost',
          title: `${jobLabel(r)} — cost at ${pct}% of contract`,
          detail: `Cost ${formatCents(r.costCents)} against contract ${formatCents(r.contractCents)} (threshold ${settings.overBudgetPct}%).`,
          suggestedAction:
            'Freeze discretionary spend on this job and review change orders with the PM.',
          jobId: r.jobId,
          entityType: 'crm_jobs',
          entityId: r.jobId,
          facts: {
            costCents: r.costCents,
            contractCents: r.contractCents,
            pct,
          },
        } satisfies Finding;
      });
  },
};

const jobMarginThin: Rule = {
  key: 'job_margin_thin',
  label: 'Thin job margin',
  description: 'Remaining margin on a contracted job is under the org floor.',
  category: 'job_cost',
  evaluate({ settings, rollups }) {
    return rollups
      .filter((r) => {
        if (r.contractCents === null || r.contractCents <= 0) return false;
        if (r.marginPct === null) return false;
        // Over-budget is a stronger signal — leave that to job_over_budget.
        if (r.costCents >= r.contractCents) return false;
        return r.marginPct < settings.marginFloorPct;
      })
      .map(
        (r) =>
          ({
            ruleKey: 'job_margin_thin',
            fingerprint: `job_margin_thin:${r.jobId}`,
            severity: 'warn',
            category: 'job_cost',
            title: `${jobLabel(r)} — margin ${r.marginPct!.toFixed(1)}% (floor ${settings.marginFloorPct}%)`,
            detail: `Cost ${formatCents(r.costCents)} leaves ${formatCents(r.marginCents)} on a ${formatCents(r.contractCents)} contract.`,
            suggestedAction:
              'Review labor and equipment burn with the PM before the next crew day.',
            jobId: r.jobId,
            entityType: 'crm_jobs',
            entityId: r.jobId,
            facts: {
              marginPct: r.marginPct,
              marginFloorPct: settings.marginFloorPct,
              costCents: r.costCents,
              contractCents: r.contractCents,
            },
          }) satisfies Finding,
      );
  },
};

const unbilledCost: Rule = {
  key: 'unbilled_cost',
  label: 'Unbilled cost',
  description: 'Meaningful cost has been posted with little or no invoice against it.',
  category: 'job_cost',
  evaluate({ settings, rollups }) {
    return rollups
      .filter(
        (r) =>
          r.costCents >= settings.unbilledCostWarnCents &&
          r.invoicedCents < r.costCents * 0.5,
      )
      .map(
        (r) =>
          ({
            ruleKey: 'unbilled_cost',
            fingerprint: `unbilled_cost:${r.jobId}`,
            severity: 'warn',
            category: 'job_cost',
            title: `${jobLabel(r)} — ${formatCents(r.costCents)} cost, ${formatCents(r.invoicedCents)} billed`,
            detail:
              'More than half the cost sitting on this job is still unbilled. Cash and AR will lag until an invoice goes out.',
            suggestedAction:
              'Draft a progress invoice (or a final invoice if the job is done) and send it today.',
            jobId: r.jobId,
            entityType: 'crm_jobs',
            entityId: r.jobId,
            facts: {
              costCents: r.costCents,
              invoicedCents: r.invoicedCents,
              thresholdCents: settings.unbilledCostWarnCents,
            },
          }) satisfies Finding,
      );
  },
};

const cashLow: Rule = {
  key: 'cash_low',
  label: 'Cash below runway floor',
  description: 'Connected bank cash is under the org cash floor.',
  category: 'cash',
  evaluate({ settings, accounts }) {
    const bankAccounts = accounts.filter((a) =>
      ['checking', 'savings', 'other_bank'].includes(a.accountType),
    );
    // No observed balances yet — do not invent a cash crisis.
    if (!bankAccounts.some((a) => a.balanceCents !== null)) return [];

    const cash = totalCashCents(accounts);
    if (cash >= settings.cashFloorCents) return [];

    return [
      {
        ruleKey: 'cash_low',
        fingerprint: 'cash_low:org',
        severity: cash <= settings.cashFloorCents * 0.5 ? 'critical' : 'warn',
        category: 'cash',
        title: `Cash on hand ${formatCents(cash)} (floor ${formatCents(settings.cashFloorCents)})`,
        detail:
          'Observed bank balances across connected checking and savings accounts are under the runway floor set for this organization.',
        suggestedAction:
          'Prioritize collections on aged AR and pause non-essential spend until cash recovers.',
        entityType: 'finance_accounts',
        facts: { cashCents: cash, floorCents: settings.cashFloorCents },
      } satisfies Finding,
    ];
  },
};

const connectionStale: Rule = {
  key: 'connection_stale',
  label: 'Stale finance connection',
  description: 'A bank or accounting connection has not synced within the allowed interval.',
  category: 'connection',
  evaluate({ settings, connections, now }) {
    return connections
      .filter((c) => c.enabled && c.status !== 'disabled')
      .flatMap((c) => {
        const findings: Finding[] = [];
        if (c.status === 'error') {
          findings.push({
            ruleKey: 'connection_stale',
            fingerprint: `connection_error:${c.id}`,
            severity: 'critical',
            category: 'connection',
            title: `${c.label} — connection error`,
            detail: c.lastError ?? c.statusDetail ?? 'The last sync failed.',
            suggestedAction:
              'Re-authorize the connection or check the credential. The agent can only report what it can see.',
            connectionId: c.id,
            entityType: 'finance_connections',
            entityId: c.id,
            facts: { provider: c.provider, status: c.status },
          });
        }

        const last = c.lastSyncAt ? new Date(c.lastSyncAt) : null;
        const hours = last
          ? (now.getTime() - last.getTime()) / 3_600_000
          : Number.POSITIVE_INFINITY;
        if (hours >= settings.connectionStaleHours) {
          findings.push({
            ruleKey: 'connection_stale',
            fingerprint: `connection_stale:${c.id}`,
            severity: 'warn',
            category: 'connection',
            title: `${c.label} — not synced in ${
              Number.isFinite(hours) ? Math.floor(hours) + 'h' : 'ever'
            }`,
            detail: `Access is ${c.accessMode.replace('_', '-')}. Provider: ${c.provider} via ${c.accessPath}.`,
            suggestedAction: 'Run a sync now, or reconnect if credentials expired.',
            connectionId: c.id,
            entityType: 'finance_connections',
            entityId: c.id,
            facts: {
              provider: c.provider,
              hoursSinceSync: Number.isFinite(hours) ? Math.floor(hours) : null,
              thresholdHours: settings.connectionStaleHours,
            },
          });
        }
        return findings;
      });
  },
};

const booksOutOfBalance: Rule = {
  key: 'books_out_of_balance',
  label: 'Bank vs books divergence',
  description: 'Observed bank cash and accounting-system cash disagree beyond tolerance.',
  category: 'books',
  evaluate({ settings, accounts, connections }) {
    const hasBank = connections.some((c) => c.kind === 'bank' && c.enabled);
    const hasBooks = connections.some((c) => c.kind === 'accounting' && c.enabled);
    if (!hasBank || !hasBooks) return [];

    const bankIds = new Set(
      connections.filter((c) => c.kind === 'bank').map((c) => c.id),
    );
    const booksIds = new Set(
      connections.filter((c) => c.kind === 'accounting').map((c) => c.id),
    );

    const bankCash = accounts
      .filter(
        (a) =>
          a.isActive &&
          a.connectionId &&
          bankIds.has(a.connectionId) &&
          a.balanceCents !== null &&
          ['checking', 'savings', 'other_bank'].includes(a.accountType),
      )
      .reduce((s, a) => s + (a.balanceCents ?? 0), 0);

    const booksCash = accounts
      .filter(
        (a) =>
          a.isActive &&
          a.connectionId &&
          booksIds.has(a.connectionId) &&
          a.balanceCents !== null &&
          ['checking', 'savings', 'other_bank'].includes(a.accountType),
      )
      .reduce((s, a) => s + (a.balanceCents ?? 0), 0);

    // Need at least one observed balance on each side.
    const bankObserved = accounts.some(
      (a) => a.connectionId && bankIds.has(a.connectionId) && a.balanceCents !== null,
    );
    const booksObserved = accounts.some(
      (a) => a.connectionId && booksIds.has(a.connectionId) && a.balanceCents !== null,
    );
    if (!bankObserved || !booksObserved) return [];

    const delta = Math.abs(bankCash - booksCash);
    if (delta <= settings.booksBalanceToleranceCents) return [];

    return [
      {
        ruleKey: 'books_out_of_balance',
        fingerprint: 'books_out_of_balance:org',
        severity: delta > settings.booksBalanceToleranceCents * 5 ? 'critical' : 'warn',
        category: 'books',
        title: `Bank and books differ by ${formatCents(delta)}`,
        detail: `Bank cash ${formatCents(bankCash)} vs books cash ${formatCents(booksCash)} (tolerance ${formatCents(settings.booksBalanceToleranceCents)}).`,
        suggestedAction:
          'Reconcile uncleared transactions in QuickBooks (or your books) against the bank feed.',
        entityType: 'finance_accounts',
        facts: {
          bankCashCents: bankCash,
          booksCashCents: booksCash,
          deltaCents: delta,
          toleranceCents: settings.booksBalanceToleranceCents,
        },
      } satisfies Finding,
    ];
  },
};

export const RULES: Rule[] = [
  arAgingCritical,
  arAgingWarn,
  jobOverBudget,
  jobMarginThin,
  unbilledCost,
  cashLow,
  connectionStale,
  booksOutOfBalance,
];

export function ruleCatalogue(): { key: string; label: string; description: string; category: string }[] {
  return RULES.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    category: r.category,
  }));
}

export function evaluateRules(snapshot: FinanceSnapshot): {
  findings: Finding[];
  rulesEvaluated: number;
  rulesSkipped: string[];
} {
  const disabled = new Set(snapshot.settings.disabledRules);
  const findings: Finding[] = [];
  const rulesSkipped: string[] = [];
  let rulesEvaluated = 0;

  for (const rule of RULES) {
    if (disabled.has(rule.key)) {
      rulesSkipped.push(rule.key);
      continue;
    }
    rulesEvaluated += 1;
    findings.push(...rule.evaluate(snapshot));
  }

  return { findings, rulesEvaluated, rulesSkipped };
}
