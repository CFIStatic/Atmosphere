import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { buildConnectors, type ConnectorSet } from './connectors/index.js';
import { VendorError } from './connectors/http.js';
import { isModelAvailable } from './ai/client.js';
import { analysePhotos, type PhotoWithBytes } from './ai/photoAnalysis.js';
import { EMPTY_DIRECTIVES, readJobNotes, type JobDirectives } from './ai/noteAnalysis.js';
import { matchJob, scoreJob } from './matching/jobMatcher.js';
import { deriveRebuildScope } from './scope/rebuildFromMitigation.js';
import { buildScope } from './scope/scopeBuilder.js';
import { buildEstimate, readinessIssues } from './estimate/estimateBuilder.js';
import { parseMitigationEstimate } from './estimate/mitigationImport.js';
import * as store from './store.js';
import type {
  ConstructionEstimate,
  CrmJob,
  DamageObservation,
  EstimatorRun,
  MatchCandidate,
  MitigationEstimate,
  RunEvent,
  RunStage,
  ScanProject,
} from './types.js';

/**
 * The Construction Estimator pipeline.
 *
 * A run walks a fixed sequence — read the scan, identify the job, read the
 * photos and the notes, read the mitigation estimate, build scope, price it —
 * and then **stops**. Writing an estimate into a customer's Xactimate account
 * is outward-facing and awkward to undo, so no run ever does it on its own:
 * every run ends at `awaiting_review`, and a person approves the export.
 *
 * The other deliberate pause is job matching. If the matcher cannot separate
 * two candidate jobs, the run parks at `awaiting_review` with the candidates
 * rather than picking one, because building an estimate against the wrong claim
 * is the single worst thing this agent could do.
 *
 * Each stage persists what it produced before the next one starts. That is what
 * makes a run resumable: choosing a job after a review does not re-download the
 * scan or re-analyse forty photos.
 */

export interface RunContext {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
}

/* ------------------------------------------------------------------ */
/* Event log                                                           */
/* ------------------------------------------------------------------ */

class RunLog {
  private readonly events: RunEvent[];

  constructor(existing: RunEvent[] = []) {
    this.events = [...existing];
  }

  add(stage: RunStage, message: string, level: RunEvent['level'] = 'info'): RunEvent[] {
    this.events.push({ at: new Date().toISOString(), stage, level, message });
    return this.all();
  }

  all(): RunEvent[] {
    // Keep the log bounded: a run with many photos can otherwise grow the row
    // without limit, and only the recent history is useful.
    return this.events.slice(-200);
  }
}

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

async function ensureScanProject(
  run: EstimatorRun,
  connectors: ConnectorSet,
): Promise<ScanProject> {
  if (run.scanProject) return run.scanProject;
  return connectors.scan.getProject(run.scanProjectId);
}

/**
 * Identify the CRM job.
 *
 * Returns `null` when the run must stop for a human. The candidates are
 * persisted by the caller so the review UI has something to choose from.
 */
async function resolveJob(
  scan: ScanProject,
  connectors: ConnectorSet,
  selectedJobId: string | undefined,
): Promise<
  | { job: CrmJob; score: number | null; reason: string; candidates: MatchCandidate[] }
  | { job: null; reason: string; candidates: MatchCandidate[] }
> {
  if (selectedJobId) {
    const job = await connectors.crm.getJob(selectedJobId);
    return {
      job,
      score: scoreJob(scan, job).score,
      reason: 'Job selected by a reviewer.',
      candidates: [],
    };
  }

  const candidates = await connectors.crm.searchJobs({
    claimNumber: scan.claimNumber,
    insuredName: scan.insuredName,
    address: scan.address.street,
    postalCode: scan.address.postalCode,
    limit: 25,
  });

  const result = matchJob(scan, candidates);
  const ranked: MatchCandidate[] = candidates
    .map((job) => {
      const scored = scoreJob(scan, job);
      return {
        jobId: job.id,
        jobNumber: job.jobNumber,
        claimNumber: job.claimNumber,
        insuredName: job.insuredName,
        address: [job.address.street, job.address.city, job.address.state]
          .filter(Boolean)
          .join(', '),
        lossDate: job.lossDate,
        score: scored.score,
        signals: scored.signals,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (result.needsReview || !result.best) {
    return { job: null, reason: result.reason, candidates: ranked };
  }

  // The matched candidate came from a search result, which may be a summary.
  // Re-fetch it so notes and documents are complete.
  const job = await connectors.crm.getJob(result.best.job.id);
  return { job, score: result.best.score, reason: result.reason, candidates: ranked };
}

/**
 * Download and read the photos.
 *
 * Bounded by `maxPhotosPerRun`, and the cap is reported rather than applied
 * silently — a scope built from half the photos with no warning is worse than
 * one that says which half it read.
 */
async function analysePhotosForRun(
  scan: ScanProject,
  connectors: ConnectorSet,
  jobSummary: string | undefined,
  log: RunLog,
): Promise<DamageObservation[]> {
  if (!isModelAvailable()) {
    log.add(
      'analyzing_photos',
      'No model is configured, so photos were not analysed. Scope was built from the measurements and the mitigation estimate.',
      'warn',
    );
    return [];
  }

  if (scan.photos.length === 0) {
    log.add('analyzing_photos', 'The scan has no photos attached.', 'warn');
    return [];
  }

  const selected = scan.photos.slice(0, config.estimator.maxPhotosPerRun);
  if (selected.length < scan.photos.length) {
    log.add(
      'analyzing_photos',
      `The scan has ${scan.photos.length} photos; the first ${selected.length} were analysed (per-run cap).`,
      'warn',
    );
  }

  const downloaded: PhotoWithBytes[] = [];
  for (const photo of selected) {
    try {
      const { bytes, contentType } = await connectors.scan.downloadPhoto(photo);
      downloaded.push({ photo, bytes, contentType });
    } catch (err) {
      log.add(
        'analyzing_photos',
        `Photo ${photo.id} could not be downloaded: ${describe(err)}`,
        'warn',
      );
    }
  }

  const { observations, failures } = await analysePhotos(downloaded, {
    rooms: scan.rooms,
    jobSummary,
  });

  for (const failure of failures) {
    log.add('analyzing_photos', `Photo ${failure.photoId}: ${failure.reason}`, 'warn');
  }
  log.add(
    'analyzing_photos',
    `Read ${downloaded.length} photo(s); found ${observations.length} damage observation(s).`,
  );

  return observations;
}

/**
 * Find the mitigation estimate.
 *
 * Three places it can come from, in order of directness: pasted in by the
 * caller, attached to the CRM job, or pulled from the estimating platform by
 * claim number. Absence is normal — plenty of construction jobs have no
 * mitigation phase — so this returns null rather than failing.
 */
async function findMitigationEstimate(
  job: CrmJob,
  connectors: ConnectorSet,
  suppliedText: string | undefined,
  log: RunLog,
): Promise<MitigationEstimate | null> {
  if (suppliedText) {
    const parsed = parseMitigationEstimate(suppliedText, { source: 'supplied by the user' });
    log.add('reading_mitigation', `Read ${parsed.lineItems.length} line(s) from the supplied mitigation estimate.`);
    return parsed;
  }

  const attachment = (job.documents ?? []).find((doc) =>
    /(mitigation|dry\s*out|dryout|water)/i.test(doc.name),
  );
  if (attachment) {
    try {
      const { bytes, contentType } = await connectors.crm.downloadDocument(job.id, attachment.id);
      const parsed = parseMitigationEstimate(bytes.toString('utf8'), {
        source: attachment.name,
        format: contentType.includes('xml') ? 'xml' : 'auto',
      });
      log.add(
        'reading_mitigation',
        `Read ${parsed.lineItems.length} line(s) from "${attachment.name}" on the job.`,
      );
      return parsed;
    } catch (err) {
      log.add(
        'reading_mitigation',
        `"${attachment.name}" could not be read: ${describe(err)}`,
        'warn',
      );
    }
  }

  if (job.claimNumber && connectors.estimating.fetchMitigationEstimate) {
    try {
      const fetched = await connectors.estimating.fetchMitigationEstimate(job.claimNumber);
      if (fetched) {
        log.add(
          'reading_mitigation',
          `Pulled ${fetched.lineItems.length} line(s) from the mitigation estimate on claim ${job.claimNumber}.`,
        );
        return fetched;
      }
    } catch (err) {
      log.add('reading_mitigation', `Could not pull a mitigation estimate: ${describe(err)}`, 'warn');
    }
  }

  log.add(
    'reading_mitigation',
    'No mitigation estimate was found — the rebuild scope comes from the scan and photos alone.',
  );
  return null;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export interface ExecuteOptions {
  /** Set when a reviewer has chosen the job, bypassing the matcher. */
  selectedJobId?: string;
  /** A mitigation estimate pasted or uploaded by the caller. */
  mitigationText?: string;
}

async function execute(
  context: RunContext,
  initialRun: EstimatorRun,
  options: ExecuteOptions,
): Promise<void> {
  const log = new RunLog(initialRun.events);
  const runId = initialRun.id;

  const patch = (fields: store.RunPatch) =>
    store.updateRun(context.supabase, runId, { ...fields, events: log.all() });

  try {
    /* --- connect ------------------------------------------------- */
    log.add('connecting', 'Connecting to DocuSketch, Dash, and Xactimate.');
    await patch({ stage: 'connecting', status: 'running', error: null });

    const secrets = await store.loadSecrets(context.supabase, context.orgId);
    const connectors = buildConnectors(secrets);
    if (connectors.mode === 'sandbox') {
      log.add('connecting', 'Running against sandbox fixtures — no vendor account is being touched.', 'warn');
    }

    /* --- scan ---------------------------------------------------- */
    log.add('fetching_scan', `Reading scan project ${initialRun.scanProjectId}.`);
    await patch({ stage: 'fetching_scan' });

    const scan = await ensureScanProject(initialRun, connectors);
    log.add(
      'fetching_scan',
      `Scan has ${scan.rooms.length} room(s) and ${scan.photos.length} photo(s).`,
    );
    await patch({ scanProject: scan });

    /* --- job ----------------------------------------------------- */
    log.add('matching_job', 'Looking for the matching job in the CRM.');
    await patch({ stage: 'matching_job' });

    const match = await resolveJob(scan, connectors, options.selectedJobId ?? initialRun.crmJobId ?? undefined);

    if (!match.job) {
      // Stop rather than guess. This is the branch that prevents an estimate
      // being built against somebody else's claim.
      log.add('matching_job', match.reason, 'warn');
      await patch({
        status: 'awaiting_review',
        stage: 'matching_job',
        matchNeedsReview: true,
        matchCandidates: match.candidates,
        matchReason: match.reason,
      });
      return;
    }

    log.add('matching_job', `${match.reason} Job ${match.job.jobNumber ?? match.job.id}.`);
    await patch({
      job: match.job,
      crmJobId: match.job.id,
      matchScore: match.score,
      matchNeedsReview: false,
      matchCandidates: match.candidates,
      matchReason: match.reason,
    });

    /* --- notes --------------------------------------------------- */
    let directives: JobDirectives = EMPTY_DIRECTIVES;
    if (isModelAvailable()) {
      try {
        directives = await readJobNotes(match.job, scan.rooms);
        log.add(
          'matching_job',
          directives.summary
            ? `Job notes: ${directives.summary}`
            : 'Job notes read; nothing scope-changing found.',
        );
      } catch (err) {
        log.add('matching_job', `Job notes could not be read: ${describe(err)}`, 'warn');
      }
    }

    /* --- photos -------------------------------------------------- */
    log.add('analyzing_photos', 'Reading the field photos.');
    await patch({ stage: 'analyzing_photos' });

    const observations =
      initialRun.observations.length > 0
        ? initialRun.observations
        : await analysePhotosForRun(scan, connectors, directives.summary || match.job.lossType, log);
    await patch({ observations });

    /* --- mitigation ---------------------------------------------- */
    log.add('reading_mitigation', 'Looking for a mitigation estimate.');
    await patch({ stage: 'reading_mitigation' });

    const mitigation =
      initialRun.mitigation ??
      (await findMitigationEstimate(match.job, connectors, options.mitigationText, log));
    await patch({ mitigation });

    /* --- scope --------------------------------------------------- */
    log.add('building_scope', 'Building the rebuild scope.');
    await patch({ stage: 'building_scope' });

    const derivation = mitigation ? deriveRebuildScope(mitigation) : null;
    if (derivation) {
      log.add(
        'building_scope',
        `Derived ${derivation.items.length} rebuild item(s) from the mitigation estimate; ` +
          `${derivation.skipped.length} line(s) were mitigation-only or had no rebuild equivalent.`,
      );
    }

    const scope = buildScope({
      rooms: scan.rooms,
      observations,
      directives,
      mitigationItems: derivation?.items,
      address: match.job.address,
    });

    for (const warning of scope.warnings) log.add('building_scope', warning, 'warn');
    if (scope.dependentsAdded > 0) {
      log.add(
        'building_scope',
        `Knowledge base expanded ${scope.dependentsAdded} companion line(s) (assemblies, MEP resets, cleaning).`,
      );
    }
    for (const note of scope.equipmentNotes) log.add('building_scope', note);
    if (scope.jurisdiction) {
      log.add('building_scope', `Applied local code pack: ${scope.jurisdiction}.`);
    }

    if (scope.items.length === 0) {
      throw new HttpError(
        422,
        'No work could be scoped from this scan. Check that the photos are tagged to rooms, or supply the mitigation estimate.',
        'empty_scope',
      );
    }

    /* --- price --------------------------------------------------- */
    log.add('pricing', 'Assembling the estimate.');
    await patch({ stage: 'pricing' });

    const basis: ConstructionEstimate['basis'] =
      derivation && observations.length > 0 ? 'both' : derivation ? 'mitigation' : 'scan';

    const estimate = buildEstimate({
      job: match.job,
      rooms: scan.rooms,
      scope: scope.items,
      basis,
      warnings: scope.warnings,
      derivation,
      mitigation,
    });

    if (estimate.completeness) {
      log.add(
        'pricing',
        `Completeness: ${estimate.completeness.criticalCount} critical, ` +
          `${estimate.completeness.warningCount} warning(s), ` +
          `${estimate.completeness.unmatchedRemovals.length} unmatched mitigation removal(s).`,
        estimate.completeness.criticalCount > 0 ? 'warn' : 'info',
      );
    }

    log.add(
      'awaiting_review',
      `Estimate ready: ${estimate.summary.lineItemCount} line item(s) across ${estimate.summary.roomCount} room(s), ` +
        `${estimate.summary.itemsNeedingReview} flagged for review. Approve it to write it to Xactimate.`,
    );

    await patch({ estimate, status: 'awaiting_review', stage: 'awaiting_review' });
  } catch (err) {
    const message = describe(err);
    log.add(initialRun.stage, message, 'error');
    await store
      .updateRun(context.supabase, runId, {
        status: 'failed',
        error: message,
        events: log.all(),
      })
      // The run has already failed; a failure to record that must not replace
      // the original error with a less useful one.
      .catch(() => undefined);
  }
}

/** Start a run. Returns as soon as the row exists; the work continues behind it. */
export async function startRun(
  context: RunContext,
  params: { scanProjectId: string; mitigationText?: string },
): Promise<EstimatorRun> {
  const run = await store.createRun(context.supabase, {
    orgId: context.orgId,
    userId: context.userId,
    scanProjectId: params.scanProjectId,
  });

  void execute(context, run, { mitigationText: params.mitigationText });
  return run;
}

/** Resume a run that stopped for job selection. */
export async function selectJobAndResume(
  context: RunContext,
  runId: string,
  jobId: string,
): Promise<EstimatorRun> {
  const run = await store.getRun(context.supabase, runId);
  if (run.status === 'complete') {
    throw new HttpError(409, 'That run has already been exported.', 'run_complete');
  }

  const resumed = await store.updateRun(context.supabase, runId, {
    status: 'running',
    crmJobId: jobId,
    matchNeedsReview: false,
    error: null,
  });

  void execute(context, resumed, { selectedJobId: jobId });
  return resumed;
}

/**
 * Approve the estimate and write it out.
 *
 * The only step that changes anything in a customer's Xactimate account, and
 * the only one a person has to ask for. It refuses on an estimate that is not
 * ready — a zero-quantity line is a question, not a scope.
 */
export async function approveAndExport(
  context: RunContext,
  runId: string,
): Promise<EstimatorRun> {
  const run = await store.getRun(context.supabase, runId);

  if (!run.estimate) {
    throw new HttpError(409, 'This run has no estimate to export yet.', 'no_estimate');
  }
  if (run.status === 'complete') {
    throw new HttpError(409, 'This estimate has already been exported.', 'already_exported');
  }

  const issues = readinessIssues(run.estimate);
  if (issues.length > 0) {
    throw new HttpError(422, `The estimate is not ready to export. ${issues.join(' ')}`, 'estimate_not_ready');
  }

  const log = new RunLog(run.events);
  log.add('exporting', 'Writing the estimate to Xactimate.');
  await store.updateRun(context.supabase, runId, {
    status: 'running',
    stage: 'exporting',
    events: log.all(),
  });

  try {
    const secrets = await store.loadSecrets(context.supabase, context.orgId);
    const connectors = buildConnectors(secrets);
    const result = await connectors.estimating.createEstimate(run.estimate);

    log.add('complete', `Estimate written as ${result.reference}.`);
    return await store.updateRun(context.supabase, runId, {
      status: 'complete',
      stage: 'complete',
      exportRef: result.reference,
      events: log.all(),
    });
  } catch (err) {
    const message = describe(err);
    log.add('exporting', message, 'error');
    await store.updateRun(context.supabase, runId, {
      status: 'awaiting_review',
      stage: 'awaiting_review',
      error: message,
      events: log.all(),
    });
    throw err instanceof HttpError ? err : new HttpError(502, message, 'export_failed');
  }
}

/** A human-readable message from anything that can be thrown. */
function describe(err: unknown): string {
  if (err instanceof VendorError) return `${err.vendor}: ${err.message}`;
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
