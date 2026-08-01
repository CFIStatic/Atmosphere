import type { SupabaseClient } from '@supabase/supabase-js';
import { rollupJobCosts } from './jobCost.js';
import * as store from './store.js';
import type { FinanceSnapshot } from './types.js';

/**
 * One working set for the rule engine and the CFO brief.
 *
 * CRM jobs and work_logs are best-effort: a project without those migrations
 * still gets connection/cash rules over the finance_* tables alone.
 */

export interface LoadSnapshotOptions {
  now?: Date;
  jobId?: string;
}

export async function loadOrgSnapshot(
  supabase: SupabaseClient,
  orgId: string,
  options: LoadSnapshotOptions = {},
): Promise<FinanceSnapshot> {
  const now = options.now ?? new Date();

  const [settings, connections, accounts, jobs, costs, costCodes] = await Promise.all([
    store.getSettings(supabase, orgId),
    store.listConnections(supabase, orgId),
    store.listAccounts(supabase, orgId),
    store.listJobMoney(supabase, orgId),
    store.listJobCosts(supabase, orgId, { status: 'posted', limit: 2000 }),
    store.listCostCodes(supabase, orgId),
  ]);

  let filteredJobs = jobs;
  if (options.jobId) {
    filteredJobs = jobs.filter((j) => j.id === options.jobId);
  }

  const laborMinutes = await store.workLogMinutesByJob(
    supabase,
    orgId,
    filteredJobs.map((j) => j.id),
  );

  const postedCosts = costs.filter((c) => c.status === 'posted');
  const rollups = rollupJobCosts(filteredJobs, postedCosts, laborMinutes, settings, now);

  return {
    orgId,
    now,
    settings,
    connections,
    accounts,
    jobs: filteredJobs,
    rollups,
    costCodes,
  };
}
