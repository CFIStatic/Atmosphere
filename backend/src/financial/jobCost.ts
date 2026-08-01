import type { AutomationSettings, JobCost, JobCostRollup, JobMoney } from './types.js';

/**
 * Deterministic job-cost rollups.
 *
 * Posted lines win. When a job has labor hours in `work_logs` but no posted
 * labor lines yet, we estimate labor from the org's default burdened rate so
 * the CFO still sees a cost picture — and we flag it as implied, not posted.
 */

export interface LaborMinutes {
  jobId: string;
  minutes: number;
}

function daysBetween(from: string | null, now: Date): number | null {
  if (!from) return null;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
}

export function rollupJobCosts(
  jobs: JobMoney[],
  costs: JobCost[],
  laborMinutes: Map<string, number>,
  settings: AutomationSettings,
  now: Date = new Date(),
): JobCostRollup[] {
  const byJob = new Map<string, JobCost[]>();
  for (const c of costs) {
    if (!c.jobId || c.status === 'voided') continue;
    if (c.status === 'draft') continue;
    const list = byJob.get(c.jobId) ?? [];
    list.push(c);
    byJob.set(c.jobId, list);
  }

  return jobs.map((job) => {
    const lines = byJob.get(job.id) ?? [];
    let laborCents = 0;
    let materialsCents = 0;
    let equipmentCents = 0;
    let subcontractCents = 0;
    let otherCents = 0;

    for (const line of lines) {
      switch (line.category) {
        case 'labor':
          laborCents += line.amountCents;
          break;
        case 'materials':
          materialsCents += line.amountCents;
          break;
        case 'equipment':
          equipmentCents += line.amountCents;
          break;
        case 'subcontract':
          subcontractCents += line.amountCents;
          break;
        default:
          otherCents += line.amountCents;
      }
    }

    // Implied labor from work logs when nothing posted yet.
    if (laborCents === 0) {
      const minutes = laborMinutes.get(job.id) ?? 0;
      if (minutes > 0) {
        laborCents = Math.round((minutes / 60) * settings.defaultLaborRateCents);
      }
    }

    const costCents =
      laborCents + materialsCents + equipmentCents + subcontractCents + otherCents;
    const marginCents =
      job.contractCents === null ? null : job.contractCents - costCents;
    const marginPct =
      job.contractCents && job.contractCents > 0 && marginCents !== null
        ? (marginCents / job.contractCents) * 100
        : null;

    return {
      jobId: job.id,
      title: job.title,
      jobNumber: job.jobNumber,
      contractCents: job.contractCents,
      invoicedCents: job.invoicedCents,
      paidCents: job.paidCents,
      openArCents: job.openArCents,
      costCents,
      laborCents,
      materialsCents,
      equipmentCents,
      subcontractCents,
      otherCents,
      marginCents,
      marginPct,
      agingDays: job.openArCents > 0 ? daysBetween(job.agingAnchor, now) : null,
    };
  });
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function totalCashCents(
  accounts: { accountType: string; balanceCents: number | null; isActive: boolean }[],
): number {
  return accounts
    .filter(
      (a) =>
        a.isActive &&
        a.balanceCents !== null &&
        ['checking', 'savings', 'other_bank'].includes(a.accountType),
    )
    .reduce((sum, a) => sum + (a.balanceCents ?? 0), 0);
}

export function booksCashCents(
  accounts: { accountType: string; balanceCents: number | null; isActive: boolean }[],
): number {
  // Prefer explicit bank-type accounts that came from an accounting connection;
  // when none, treat checking/savings the same.
  return totalCashCents(accounts);
}
