import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../../config.js';
import { buildEstimatorConfig } from '../settings.js';
import {
  getSettings,
  listDeviations,
  saveSettings,
  type StoredSettings,
} from '../store.js';
import { syncCaptureAndRebuild, type CaptureSyncResult } from './sync.js';
import type { CaptureSourceKind } from './connectors.js';

/**
 * Capture agent — the unattended loop.
 *
 * This is an agent platform: drying reports from MICA Dash and Outlook are not
 * a button the estimator clicks. The agent watches open mitigation jobs, pulls
 * capture apps on a schedule (and on webhook push), merges new visits, and
 * rewrites the estimate. A human reviews the result; they do not drive the
 * sync.
 */

export interface CaptureJobTarget {
  orgId: string;
  /** Internal estimator_jobs.id */
  internalJobId: string;
  /** External job id used on estimates / drying report keys. */
  externalJobId: string;
  claimNumber: string | null;
  createdBy: string;
  name: string;
  status: string;
}

export interface CaptureAgentPassResult {
  jobsConsidered: number;
  jobsUpdated: number;
  visitsImported: number;
  estimatesSaved: number;
  errors: Array<{ jobId: string; message: string }>;
  results: CaptureSyncResult[];
  ranAt: string;
}

export interface CaptureAgentStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: string;
  lastPass?: CaptureAgentPassResult;
  sources: CaptureSourceKind[];
}

/**
 * List open mitigation jobs the agent should watch.
 *
 * draft + review only — submitted/closed jobs are finished records, not live
 * drying work. Admin client required (RLS bypassed); call only from the
 * scheduler / system path.
 */
export async function listOpenCaptureJobs(
  admin: SupabaseClient,
  options: { orgId?: string; limit?: number } = {},
): Promise<CaptureJobTarget[]> {
  let query = admin
    .from('estimator_jobs')
    .select('id, org_id, external_job_id, claim_number, created_by, name, status')
    .in('status', ['draft', 'review'])
    .order('updated_at', { ascending: false })
    .limit(options.limit ?? 500);

  if (options.orgId) query = query.eq('org_id', options.orgId);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not list open mitigation jobs: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => row.external_job_id && row.created_by)
    .map((row) => ({
      orgId: row.org_id as string,
      internalJobId: row.id as string,
      externalJobId: row.external_job_id as string,
      claimNumber: (row.claim_number as string | null) ?? null,
      createdBy: row.created_by as string,
      name: row.name as string,
      status: row.status as string,
    }));
}

/**
 * Run the capture agent for one job: pull MICA Dash + Outlook, merge, rebuild.
 */
export async function runCaptureAgentForJob(
  admin: SupabaseClient,
  job: CaptureJobTarget,
  options: {
    sources?: CaptureSourceKind[];
    since?: string;
    payload?: unknown;
    payloadSource?: CaptureSourceKind;
  } = {},
): Promise<CaptureSyncResult> {
  const stored = await getSettings(admin, job.orgId);
  const { config: estimatorConfig } = buildEstimatorConfig(stored, null);
  const deviations = await listDeviations(admin, job.orgId, job.externalJobId);

  // Prefer "since last visit" so pulls stay incremental.
  const since =
    options.since ??
    stored.captureAgent?.lastVisitAtByJob?.[job.externalJobId] ??
    undefined;

  const result = await syncCaptureAndRebuild(
    admin,
    {
      orgId: job.orgId,
      userId: job.createdBy,
      config: estimatorConfig,
      deviations,
    },
    {
      jobId: job.externalJobId,
      claimNumber: job.claimNumber ?? undefined,
      sources: options.sources ?? config.estimator.captureAgent.sources,
      since,
      payload: options.payload,
      payloadSource: options.payloadSource,
      autoRebuild: true,
      save: true,
    },
  );

  if (result.reportsImported > 0 || result.modified) {
    await recordJobVisitCursor(admin, job.orgId, job.externalJobId, stored);
  }

  return result;
}

/**
 * Full agent pass across every open mitigation job.
 */
export async function runCaptureAgentPass(
  admin: SupabaseClient,
  options: { orgId?: string } = {},
): Promise<CaptureAgentPassResult> {
  const ranAt = new Date().toISOString();
  const jobs = await listOpenCaptureJobs(admin, { orgId: options.orgId });
  const results: CaptureSyncResult[] = [];
  const errors: CaptureAgentPassResult['errors'] = [];
  let jobsUpdated = 0;
  let visitsImported = 0;
  let estimatesSaved = 0;

  for (const job of jobs) {
    try {
      const result = await runCaptureAgentForJob(admin, job);
      results.push(result);
      visitsImported += result.reportsImported;
      if (result.modified) jobsUpdated += 1;
      if (result.saved) estimatesSaved += 1;
    } catch (err) {
      errors.push({
        jobId: job.externalJobId,
        message: err instanceof Error ? err.message : 'capture agent failed',
      });
    }
  }

  const pass: CaptureAgentPassResult = {
    jobsConsidered: jobs.length,
    jobsUpdated,
    visitsImported,
    estimatesSaved,
    errors,
    results,
    ranAt,
  };

  // Persist a compact status per org touched (or all orgs with open jobs).
  const orgIds = [...new Set(jobs.map((j) => j.orgId))];
  for (const orgId of orgIds) {
    try {
      await saveCaptureAgentStatus(admin, orgId, {
        lastRunAt: ranAt,
        lastPass: {
          jobsConsidered: jobs.filter((j) => j.orgId === orgId).length,
          jobsUpdated: results.filter(
            (r) => r.modified && jobs.find((j) => j.externalJobId === r.jobId)?.orgId === orgId,
          ).length,
          visitsImported: results
            .filter((r) => jobs.find((j) => j.externalJobId === r.jobId)?.orgId === orgId)
            .reduce((sum, r) => sum + r.reportsImported, 0),
          estimatesSaved: results.filter(
            (r) => r.saved && jobs.find((j) => j.externalJobId === r.jobId)?.orgId === orgId,
          ).length,
          errors: errors.filter((e) =>
            jobs.some((j) => j.externalJobId === e.jobId && j.orgId === orgId),
          ),
          results: [],
          ranAt,
        },
      });
    } catch {
      // Status write must not fail the pass.
    }
  }

  return pass;
}

async function recordJobVisitCursor(
  admin: SupabaseClient,
  orgId: string,
  externalJobId: string,
  prior: StoredSettings,
): Promise<void> {
  const settings = await getSettings(admin, orgId);
  const captureAgent = {
    ...(prior.captureAgent ?? settings.captureAgent ?? {}),
    lastVisitAtByJob: {
      ...(prior.captureAgent?.lastVisitAtByJob ?? {}),
      ...(settings.captureAgent?.lastVisitAtByJob ?? {}),
      [externalJobId]: new Date().toISOString(),
    },
  };
  await saveSettings(admin, orgId, { ...settings, captureAgent });
}

export async function saveCaptureAgentStatus(
  admin: SupabaseClient,
  orgId: string,
  update: { lastRunAt: string; lastPass: CaptureAgentPassResult },
): Promise<void> {
  const settings = await getSettings(admin, orgId);
  await saveSettings(admin, orgId, {
    ...settings,
    captureAgent: {
      ...(settings.captureAgent ?? {}),
      lastRunAt: update.lastRunAt,
      lastPassSummary: {
        jobsConsidered: update.lastPass.jobsConsidered,
        jobsUpdated: update.lastPass.jobsUpdated,
        visitsImported: update.lastPass.visitsImported,
        estimatesSaved: update.lastPass.estimatesSaved,
        errorCount: update.lastPass.errors.length,
        ranAt: update.lastPass.ranAt,
      },
      lastVisitAtByJob: settings.captureAgent?.lastVisitAtByJob,
    },
  });
}

export function readCaptureAgentStatus(stored: StoredSettings): CaptureAgentStatus {
  return {
    enabled: config.estimator.captureAgent.enabled,
    intervalMinutes: config.estimator.captureAgent.intervalMinutes,
    lastRunAt: stored.captureAgent?.lastRunAt,
    lastPass: stored.captureAgent?.lastPassSummary
      ? {
          jobsConsidered: stored.captureAgent.lastPassSummary.jobsConsidered,
          jobsUpdated: stored.captureAgent.lastPassSummary.jobsUpdated,
          visitsImported: stored.captureAgent.lastPassSummary.visitsImported,
          estimatesSaved: stored.captureAgent.lastPassSummary.estimatesSaved,
          errors: Array.from({ length: stored.captureAgent.lastPassSummary.errorCount }, () => ({
            jobId: '?',
            message: 'see server logs',
          })),
          results: [],
          ranAt: stored.captureAgent.lastPassSummary.ranAt,
        }
      : undefined,
    sources: config.estimator.captureAgent.sources,
  };
}
