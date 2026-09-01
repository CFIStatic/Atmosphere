import type { JobSummary, ProofPulse, ProofPulseJob, SharedJobSummary } from './api';
import { jobFilePath } from './jobFileAsk';
import { jobLooksDeletedFromLibrary } from './jobFileCopy';

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

export function isOpenJob(job: { status?: string | null }): boolean {
  return OPEN_STATUSES.has(job.status ?? '');
}

export function isToday(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function daysStale(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Why this job is on the Overview. Ordered by what actually costs the office
 * if it sits: unreadable film, unanswered questions, unread film, a lapsed
 * brief, a job that cannot be judged, then status flags.
 */
export type OverviewActionKind =
  | 'failed_read'
  | 'awaiting_answer'
  | 'unread_film'
  | 'brief_behind'
  | 'no_brief'
  | 'on_hold'
  | 'urgent'
  | 'quiet';

/**
 * Where the job sits in the proof chain — not CRM status. A job that is
 * "in progress" but has no brief is not moving.
 */
export type PipelineStage =
  | 'needs_brief'
  | 'waiting_on_film'
  | 'being_read'
  | 'needs_review'
  | 'proving';

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'needs_brief',
  'waiting_on_film',
  'being_read',
  'needs_review',
  'proving',
] as const;

export const PIPELINE_META: Record<PipelineStage, { label: string; short: string; hint: string }> = {
  needs_brief: {
    label: 'Needs a brief',
    short: 'Brief',
    hint: 'Opened, nothing published to judge film against',
  },
  waiting_on_film: {
    label: 'Waiting on film',
    short: 'Film',
    hint: 'Brief is live; no clips on file yet',
  },
  being_read: { label: 'Being read', short: 'Reading', hint: 'Film is on file and still being described' },
  needs_review: { label: 'Needs a look', short: 'Look', hint: 'A failed read or an unanswered question' },
  proving: { label: 'Proving', short: 'Proving', hint: 'Film is read; the file can answer for the work' },
};

export const ACTION_META: Record<
  OverviewActionKind,
  { label: string; verb: string; score: number; tone: 'danger' | 'caution' | 'brand' | 'idle' }
> = {
  failed_read: { label: 'Read failed', verb: 'Review film', score: 100, tone: 'danger' },
  awaiting_answer: { label: 'Unanswered', verb: 'Answer', score: 90, tone: 'caution' },
  unread_film: { label: 'Unread film', verb: 'Read film', score: 80, tone: 'brand' },
  brief_behind: { label: 'Old brief', verb: 'Open brief', score: 70, tone: 'caution' },
  no_brief: { label: 'No brief', verb: 'Publish brief', score: 60, tone: 'danger' },
  on_hold: { label: 'On hold', verb: 'Open job', score: 50, tone: 'danger' },
  urgent: { label: 'Urgent', verb: 'Open job', score: 40, tone: 'caution' },
  quiet: { label: 'Quiet', verb: 'Open job', score: 20, tone: 'idle' },
};

export interface OverviewAction {
  id: string;
  kind: OverviewActionKind;
  jobId: string;
  jobNumber: number | null;
  title: string;
  headline: string;
  detail: string;
  notes: string[];
  href: string;
  score: number;
  stage: PipelineStage;
}

export interface PipelineBucket {
  stage: PipelineStage;
  label: string;
  short: string;
  hint: string;
  count: number;
}

export interface OverviewJob {
  jobId: string;
  jobNumber: number | null;
  title: string;
  stage: PipelineStage;
  action: OverviewAction | null;
}

export interface OverviewModel {
  openCount: number;
  jobs: OverviewJob[];
  actions: OverviewAction[];
  pipeline: PipelineBucket[];
  today: {
    filmed: number;
    unread: number;
    failed: number;
    analysing: number;
    jobsFilmed: number;
  };
}

export interface AttentionRow {
  job: JobSummary;
  score: number;
  stale: number | null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function stageFor(input: {
  brief: SharedJobSummary | undefined;
  pulse: ProofPulseJob | undefined;
}): PipelineStage {
  const pulse = input.pulse;
  // Only call it "needs a brief" when we have the shared record and it has
  // no revision. A missing record is not evidence — sharedJobs may have failed.
  if (input.brief && input.brief.currentRevision == null && !pulse?.clips) return 'needs_brief';
  if ((pulse?.failed ?? 0) > 0 || (input.brief?.awaiting ?? 0) > 0) return 'needs_review';
  if ((pulse?.unread ?? 0) > 0 || (pulse?.analysing ?? 0) > 0) return 'being_read';
  if ((pulse?.clips ?? 0) > 0) return 'proving';
  return 'waiting_on_film';
}

interface Candidate {
  kind: OverviewActionKind;
  headline: string;
  detail: string;
}

function candidatesFor(input: {
  job: JobSummary | undefined;
  brief: SharedJobSummary | undefined;
  pulse: ProofPulseJob | undefined;
  stale: number | null;
}): Candidate[] {
  const out: Candidate[] = [];
  const failed = input.pulse?.failed ?? 0;
  const unread = input.pulse?.unread ?? 0;
  const awaiting = input.brief?.awaiting ?? 0;
  const behind = input.brief?.behind ?? 0;
  const revision = input.brief?.currentRevision ?? null;

  if (failed > 0) {
    out.push({
      kind: 'failed_read',
      headline: `${plural(failed, 'clip', 'clips')} failed`,
      detail: 'The assistant could not read the film. A person has to look.',
    });
  }
  if (awaiting > 0) {
    out.push({
      kind: 'awaiting_answer',
      headline: `${plural(awaiting, 'question', 'questions')} unanswered`,
      detail: 'A party asked. The crew either waits or does the work anyway.',
    });
  }
  if (unread > 0) {
    out.push({
      kind: 'unread_film',
      headline: `${plural(unread, 'clip', 'clips')} waiting`,
      detail: 'Film is on file and has not been read yet.',
    });
  }
  if (behind > 0) {
    out.push({
      kind: 'brief_behind',
      headline: `${plural(behind, 'party', 'parties')} on an old brief`,
      detail: 'They are working from facts that have already been superseded.',
    });
  }
  if (input.brief && revision == null && (input.pulse?.clips ?? 0) === 0) {
    out.push({
      kind: 'no_brief',
      headline: 'No brief published',
      detail: 'Footage will be sealed, but nothing can be judged against an agreed scope.',
    });
  }
  if (input.job?.status === 'on_hold') {
    out.push({
      kind: 'on_hold',
      headline: 'On hold',
      detail: input.job.lastEvent || 'The job is parked. Proof stops until it moves.',
    });
  }
  if (input.job?.priority === 1) {
    out.push({
      kind: 'urgent',
      headline: 'Marked urgent',
      detail: input.job.lastEvent || 'The office flagged this ahead of everything else.',
    });
  }
  const hasFilm = (input.pulse?.clips ?? 0) > 0;
  if (
    input.stale != null &&
    input.stale >= 3 &&
    failed === 0 &&
    unread === 0 &&
    awaiting === 0 &&
    !hasFilm
  ) {
    out.push({
      kind: 'quiet',
      headline: `${input.stale}d quiet`,
      detail: 'No film and no movement. Either the crew is done or the job stalled.',
    });
  }
  return out;
}

function toAction(
  jobId: string,
  title: string,
  jobNumber: number | null,
  stage: PipelineStage,
  primary: Candidate,
  extras: Candidate[],
): OverviewAction {
  return {
    id: `${jobId}:${primary.kind}`,
    kind: primary.kind,
    jobId,
    jobNumber,
    title,
    headline: primary.headline,
    detail: primary.detail,
    notes: extras.map((c) => c.headline),
    href: jobFilePath(jobId, { title, number: jobNumber }),
    score: ACTION_META[primary.kind].score,
    stage,
  };
}

/**
 * Build the Overview from the three things the office already has: the job
 * list, the shared record (brief / parties), and the film pulse.
 */
export function buildOverview(
  jobs: JobSummary[],
  shared: SharedJobSummary[],
  pulse: ProofPulse | null,
  now = new Date(),
): OverviewModel {
  const jobsById = new Map(jobs.map((j) => [j.jobId, j]));
  const sharedById = new Map(shared.map((j) => [j.jobId, j]));
  const pulseById = new Map((pulse?.byJob ?? []).map((row) => [row.jobId, row]));

  const ids = new Set<string>([...jobsById.keys(), ...sharedById.keys(), ...pulseById.keys()]);
  const overviewJobs: OverviewJob[] = [];

  for (const jobId of ids) {
    const job = jobsById.get(jobId);
    const brief = sharedById.get(jobId);
    const film = pulseById.get(jobId);
    const status = job?.status ?? brief?.status ?? null;
    if (status && !isOpenJob({ status })) continue;
    // Job Files is the inventory. A Dashboard delete drops the file there;
    // do not revive it here from shared or pulse.
    if (!job || jobLooksDeletedFromLibrary(job.lastEvent)) continue;

    const title = job?.title ?? brief?.title ?? 'Job';
    const jobNumber = job?.jobNumber ?? brief?.jobNumber ?? null;
    const stale = daysStale(job?.lastEventAt ?? null, now);
    const stage = stageFor({ brief, pulse: film });
    const found = candidatesFor({ job, brief, pulse: film, stale });
    const [primary, ...extras] = found.sort((a, b) => ACTION_META[b.kind].score - ACTION_META[a.kind].score);
    const action = primary ? toAction(jobId, title, jobNumber, stage, primary, extras) : null;
    overviewJobs.push({ jobId, jobNumber, title, stage, action });
  }

  const actions = overviewJobs
    .map((j) => j.action)
    .filter((a): a is OverviewAction => a != null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const pipeline: PipelineBucket[] = PIPELINE_STAGES.map((stage) => ({
    stage,
    label: PIPELINE_META[stage].label,
    short: PIPELINE_META[stage].short,
    hint: PIPELINE_META[stage].hint,
    count: overviewJobs.filter((j) => j.stage === stage).length,
  }));

  const filmedJobIds = new Set(
    (pulse?.byJob ?? []).filter((row) => row.filmedToday > 0).map((row) => row.jobId),
  );

  return {
    openCount: overviewJobs.length,
    jobs: overviewJobs,
    actions,
    pipeline,
    today: {
      filmed: pulse?.filmedToday ?? 0,
      unread: pulse?.unread ?? 0,
      failed: pulse?.failed ?? 0,
      analysing: pulse?.analysing ?? 0,
      jobsFilmed: filmedJobIds.size,
    },
  };
}

export function emptyPulse(): ProofPulse {
  return {
    clips: 0,
    read: 0,
    analysing: 0,
    failed: 0,
    unread: 0,
    heard: 0,
    filmedToday: 0,
    byJob: [],
  };
}

/**
 * Jobs off the happy path: blocked, urgent, gone quiet, or never started.
 * Kept for callers that still want the old heuristic without the pulse.
 */
export function jobsNeedingAttention(jobs: JobSummary[], now = new Date()): AttentionRow[] {
  return jobs
    .filter(isOpenJob)
    .map((job) => {
      const stale = daysStale(job.lastEventAt, now);
      const score =
        (job.status === 'on_hold' ? 4 : 0) +
        (job.priority === 1 ? 3 : 0) +
        (stale != null && stale >= 3 ? 2 : 0);
      return { job, score, stale };
    })
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (b.job.lastEventAt ?? '').localeCompare(a.job.lastEventAt ?? ''),
    )
    .slice(0, 8);
}

export function pipelineLine(pulse: ProofPulse | null): string {
  if (!pulse) return 'Loading the analysis pipeline…';
  if (pulse.clips === 0) return 'No clips on file yet';
  const parts = [`${pulse.read} read`];
  if (pulse.analysing > 0) parts.push(`${pulse.analysing} being read`);
  if (pulse.failed > 0) parts.push(`${pulse.failed} failed`);
  if (pulse.unread > 0) parts.push(`${pulse.unread} waiting`);
  if (pulse.heard > 0) parts.push(`${pulse.heard} with mic`);
  return `${pulse.clips} clip${pulse.clips === 1 ? '' : 's'} · ${parts.join(' · ')}`;
}

export function todayLine(model: OverviewModel): string {
  const { today } = model;
  if (today.filmed === 0 && today.unread === 0 && today.failed === 0 && today.analysing === 0) {
    return 'No film landed today';
  }
  const parts: string[] = [];
  if (today.filmed > 0) {
    parts.push(
      `${plural(today.filmed, 'clip', 'clips')} filmed today${
        today.jobsFilmed > 0 ? ` on ${plural(today.jobsFilmed, 'job', 'jobs')}` : ''
      }`,
    );
  }
  if (today.unread > 0) parts.push(`${today.unread} waiting to be read`);
  if (today.analysing > 0) parts.push(`${today.analysing} being read`);
  if (today.failed > 0) parts.push(`${today.failed} failed`);
  return parts.join(' · ');
}
