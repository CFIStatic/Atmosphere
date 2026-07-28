import type { SupabaseClient } from '@supabase/supabase-js';
import { buildEstimate, type EstimatorConfig } from '../agent.js';
import type { EstimatorSources } from '../ingest/index.js';
import type { DryingReport } from '../planning/dryingProgress.js';
import type { MitigationEstimate } from '../types.js';
import {
  listDryingReports,
  saveDryingReport,
  saveEstimate,
  saveJobSources,
  getJobSources,
  type JobSourceSnapshot,
} from '../store.js';
import {
  connectorFor,
  importCapturePayload,
  type CapturePullResult,
  type CaptureSourceKind,
} from './connectors.js';

/**
 * Capture sync — pull from MICA Dash / Outlook, merge visits, rebuild estimate.
 *
 * This is the automatic path: a new drying export arrives from a capture app,
 * the visit timeline updates, and the mitigation estimate is rewritten with
 * current equipment days, dry-standard progress, and under-equipment flags.
 */

export interface CaptureSyncInput {
  jobId: string;
  sources?: CaptureSourceKind[];
  claimNumber?: string;
  since?: string;
  /** When set, skip the live pull and import this payload for `source`. */
  payload?: unknown;
  payloadSource?: CaptureSourceKind;
  /** Rebuild and optionally persist the modified estimate. Default true. */
  autoRebuild?: boolean;
  /** Persist the rebuilt estimate. Default true when autoRebuild. */
  save?: boolean;
  /** Baseline sources for rebuild when no snapshot is stored yet. */
  baselineSources?: Partial<EstimatorSources>;
}

export interface CaptureSyncResult {
  jobId: string;
  pulls: CapturePullResult[];
  /** Newly appended visits. */
  importedReports: DryingReport[];
  reportsImported: number;
  reportsSkipped: number;
  totalReports: number;
  warnings: string[];
  estimate?: MitigationEstimate;
  estimateId?: string;
  saved: boolean;
  modified: boolean;
}

export async function syncCaptureAndRebuild(
  supabase: SupabaseClient,
  ctx: {
    orgId: string;
    userId: string;
    config: EstimatorConfig;
    agreement?: EstimatorConfig['agreement'];
    deviations?: EstimatorConfig['deviations'];
  },
  input: CaptureSyncInput,
): Promise<CaptureSyncResult> {
  const warnings: string[] = [];
  const pulls: CapturePullResult[] = [];
  const autoRebuild = input.autoRebuild !== false;
  const save = input.save ?? autoRebuild;

  if (input.payload !== undefined && input.payloadSource) {
    pulls.push(
      importCapturePayload(input.payloadSource, input.payload, {
        jobId: input.jobId,
        claimNumber: input.claimNumber,
      }),
    );
  } else {
    const kinds = input.sources?.length
      ? input.sources
      : (['mica_dash', 'outlook'] as CaptureSourceKind[]);
    for (const kind of kinds) {
      try {
        const connector = connectorFor(kind);
        const pull = await connector.pull({
          jobId: input.jobId,
          claimNumber: input.claimNumber,
          since: input.since,
        });
        pulls.push(pull);
      } catch (err) {
        warnings.push(
          `${kind}: ${err instanceof Error ? err.message : 'capture pull failed'}`,
        );
      }
    }
  }

  for (const pull of pulls) warnings.push(...pull.warnings);

  const existing = await listDryingReports(supabase, ctx.orgId, input.jobId);
  const existingIds = new Set(existing.map((r) => r.id));

  const reportsImported: DryingReport[] = [];
  let reportsSkipped = 0;
  let totalReports = existing;

  for (const pull of pulls) {
    for (const report of pull.reports) {
      if (existingIds.has(report.id)) {
        reportsSkipped += 1;
        continue;
      }
      totalReports = await saveDryingReport(supabase, ctx.orgId, input.jobId, report);
      existingIds.add(report.id);
      reportsImported.push(report);
    }
  }

  // Keep the latest MICA export on the job snapshot so rebuilds stay measured.
  const micaPayload = [...pulls].reverse().find((p) => p.micaPayload)?.micaPayload;
  const priorSnapshot = await getJobSources(supabase, ctx.orgId, input.jobId);
  const snapshot: JobSourceSnapshot = {
    jobId: input.jobId,
    docusketch: input.baselineSources?.docusketch ?? priorSnapshot?.docusketch,
    mica: micaPayload ?? input.baselineSources?.mica ?? priorSnapshot?.mica,
    photos: input.baselineSources?.photos ?? priorSnapshot?.photos,
    notes: input.baselineSources?.notes ?? priorSnapshot?.notes,
    claimNumber:
      input.claimNumber ??
      pulls.find((p) => p.claimNumber)?.claimNumber ??
      priorSnapshot?.claimNumber,
    updatedAt: new Date().toISOString(),
  };
  await saveJobSources(supabase, ctx.orgId, input.jobId, snapshot);

  const modified = reportsImported.length > 0 || Boolean(micaPayload);
  let estimate: MitigationEstimate | undefined;
  let estimateId: string | undefined;
  let saved = false;

  if (autoRebuild && (modified || totalReports.length > 0)) {
    const hasSources = Boolean(
      snapshot.docusketch || snapshot.mica || snapshot.photos?.length || snapshot.notes?.trim(),
    );
    if (!hasSources && totalReports.length === 0) {
      warnings.push(
        'Capture imported visits, but no baseline sources are stored for this job yet — save an estimate once, then sync will auto-rebuild.',
      );
    } else if (hasSources || totalReports.length > 0) {
      estimate = buildEstimate(
        {
          jobId: input.jobId,
          docusketch: snapshot.docusketch,
          mica: snapshot.mica,
          photos: snapshot.photos,
          notes: snapshot.notes,
          dryingReports: totalReports,
        },
        {
          ...ctx.config,
          agreement: ctx.agreement ?? ctx.config.agreement,
          deviations: ctx.deviations ?? ctx.config.deviations,
        },
      );
      estimate.openQuestions = [
        ...new Set([...estimate.openQuestions, ...warnings.filter(Boolean)]),
      ];

      if (save && hasSources) {
        const name =
          estimate.assessment.propertyAddress ??
          estimate.assessment.claimNumber ??
          `Mitigation estimate ${new Date().toISOString().slice(0, 10)}`;
        const record = await saveEstimate(supabase, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          name,
          estimate,
        });
        estimateId = record.id;
        saved = true;
      } else if (save && !hasSources) {
        warnings.push('Rebuilt in memory only — persist a baseline estimate before auto-save.');
      }
    }
  }

  return {
    jobId: input.jobId,
    pulls,
    importedReports: reportsImported,
    reportsImported: reportsImported.length,
    reportsSkipped,
    totalReports: totalReports.length,
    warnings,
    estimate,
    estimateId,
    saved,
    modified,
  };
}
