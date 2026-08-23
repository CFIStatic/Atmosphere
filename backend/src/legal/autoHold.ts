/**
 * Automatic preservation holds.
 *
 * Freezing evidence used to be a button on the customer's own job file. That
 * is the wrong hand on the switch, for a reason that has nothing to do with
 * trust: the party most likely to want a clip gone is the party who was
 * standing in front of the camera, and the moment a hold matters most is the
 * moment nobody in that office wants to be the one who clicked it.
 *
 * So the switch moved inside. These rules read the user-action monitor —
 * which already sees every signed-in delete, every outside read of the
 * evidence portal, every clip asked about — and open a preservation hold on
 * the job when the shape of the activity says the record is about to be
 * argued over. Staff review and release. The customer is never asked, and
 * cannot lift it.
 *
 * Two properties are deliberate:
 *
 *   Nothing is ever destroyed by a rule. The only thing a rule does is
 *   freeze. A false positive costs storage; a false negative costs the case.
 *
 *   Nothing releases on its own. `reviewBy` is a queue for the legal desk,
 *   not an expiry. An automatic hold that nobody looks at stays shut.
 */
import { openHoldsForJob } from './holds.js';
import { openJobLegalHold } from './jobPortal.js';
import { listUserActivity, recordUserAction } from './monitor.js';
import { listVaultedVideos } from './vault.js';
import type { LegalHoldKind, LegalHoldRecord, LegalVaultEntry, UserActivityEvent } from './types.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** An outside party reading the file: the insurer, the adjuster, counsel. */
const OUTSIDE_REVIEW = new Set(['evidence.asked', 'evidence.library_viewed']);
const DELETED = new Set(['video.deleted']);

/** Actions worth re-evaluating a job over. Everything else is noise here. */
export const AUTO_HOLD_TRIGGER_ACTIONS = new Set([...OUTSIDE_REVIEW, ...DELETED]);

export type AutoHoldRuleKey =
  | 'delete_after_outside_review'
  | 'bulk_deletion'
  | 'sustained_outside_review';

export type AutoHoldRule = {
  key: AutoHoldRuleKey;
  /** What a person reads on the legal desk. */
  label: string;
  kind: LegalHoldKind;
  /** How long staff have to look at it before it shows up as unreviewed. */
  reviewAfterDays: number;
  why: string;
  detect: (events: UserActivityEvent[], now: number) => UserActivityEvent[] | null;
};

/**
 * Order is priority. A job fires at most one rule per sweep — the first that
 * matches — because a second hold on the same job freezes nothing new and
 * gives the desk two rows to release instead of one.
 */
export const AUTO_HOLD_RULES: AutoHoldRule[] = [
  {
    key: 'delete_after_outside_review',
    label: 'Video deleted after an outside party read the file',
    kind: 'preservation',
    reviewAfterDays: 30,
    why:
      'An outside party opened the evidence on this job, and video was deleted afterwards. ' +
      'The clips are frozen in the vault while the legal desk looks at it.',
    detect: (events, now) => {
      const reviews = events.filter((event) => OUTSIDE_REVIEW.has(event.action));
      if (!reviews.length) return null;
      const firstReview = at(reviews[0]);
      const deletes = events.filter(
        (event) =>
          DELETED.has(event.action) && at(event) >= firstReview && now - at(event) <= 30 * DAY,
      );
      if (!deletes.length) return null;
      return [...reviews.filter((event) => at(event) <= at(deletes[deletes.length - 1])), ...deletes];
    },
  },
  {
    key: 'bulk_deletion',
    label: 'A burst of deletes on one job',
    kind: 'preservation',
    reviewAfterDays: 30,
    why:
      'Three or more clips were deleted from this job inside three days. ' +
      'The vault keeps every one of them while the legal desk looks at it.',
    detect: (events, now) => {
      const deletes = events.filter((event) => DELETED.has(event.action) && now - at(event) <= 30 * DAY);
      return withinWindow(deletes, 72 * HOUR, 3);
    },
  },
  {
    key: 'sustained_outside_review',
    label: 'The file is being worked from the outside',
    kind: 'preservation',
    reviewAfterDays: 45,
    why:
      'An outside party has been reading this job file repeatedly. ' +
      'Nothing on it can age out of retention while that is true.',
    detect: (events, now) => {
      const reviews = events.filter(
        (event) => OUTSIDE_REVIEW.has(event.action) && now - at(event) <= 30 * DAY,
      );
      return withinWindow(reviews, 14 * DAY, 5);
    },
  },
];

export type AutoHoldSignal = {
  jobId: string;
  orgId: string | null;
  rule: AutoHoldRuleKey;
  label: string;
  kind: LegalHoldKind;
  reason: string;
  firedAt: string;
  reviewBy: string;
  /** The monitor rows the rule fired on, oldest first. */
  evidence: Array<{
    occurredAt: string;
    action: string;
    actor: string | null;
    resourceId: string | null;
  }>;
  /** The open hold already covering this job, if there is one. */
  heldBy: { id: string; caseNumber: string; origin: string } | null;
};

export type AutoHoldSweep = {
  ranAt: string;
  jobsEvaluated: number;
  signals: AutoHoldSignal[];
  /** Holds this sweep actually opened. */
  opened: LegalHoldRecord[];
  /** Signals skipped because the job was already frozen. */
  alreadyHeld: number;
  applied: boolean;
};

function at(event: UserActivityEvent): number {
  return Date.parse(event.occurredAt) || 0;
}

/** The oldest run of `threshold` events that all fit inside `window`. */
function withinWindow(
  events: UserActivityEvent[],
  window: number,
  threshold: number,
): UserActivityEvent[] | null {
  if (events.length < threshold) return null;
  for (let end = threshold - 1; end < events.length; end += 1) {
    const start = end - threshold + 1;
    if (at(events[end]) - at(events[start]) <= window) {
      return events.slice(start, end + 1);
    }
  }
  return null;
}

/**
 * Which job an activity row belongs to.
 *
 * The monitor records what the request named, which is usually a clip. The
 * vault is what knows the clip's job, so it is the fallback — and the reason
 * a media-catalog delete with no job in its path still lands on the right
 * file.
 */
export function jobIdForEvent(
  event: UserActivityEvent,
  vaultBySource: Map<string, LegalVaultEntry>,
): string | null {
  const fromDetail = (event.detail as { jobId?: unknown } | null)?.jobId;
  if (typeof fromDetail === 'string' && fromDetail) return fromDetail;
  if (event.resourceType === 'job' && event.resourceId) return event.resourceId;

  if (event.resourceId) {
    const kind =
      event.resourceType === 'proof'
        ? 'job_proof'
        : event.resourceType === 'media'
          ? 'media_object'
          : null;
    if (kind) {
      const entry = vaultBySource.get(`${kind}:${event.resourceId}`);
      if (entry?.jobId) return entry.jobId;
    }
  }

  const fromPath = event.path?.match(
    /\/api\/operations\/shared\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i,
  );
  return fromPath?.[1] ?? null;
}

/**
 * Run the rules. Reads only — nothing is opened here.
 *
 * `jobId` narrows the sweep to one file, which is what the live path after a
 * delete uses; without it every job the monitor has seen recently is checked.
 */
export async function evaluateAutoHolds(input?: {
  jobId?: string | null;
  now?: number;
  limit?: number;
}): Promise<AutoHoldSignal[]> {
  const now = input?.now ?? Date.now();
  const [events, vault] = await Promise.all([
    listUserActivity({ limit: 1000 }),
    listVaultedVideos(),
  ]);

  const vaultBySource = new Map(vault.map((entry) => [`${entry.sourceKind}:${entry.sourceId}`, entry]));
  const byJob = new Map<string, UserActivityEvent[]>();
  for (const event of events) {
    if (!AUTO_HOLD_TRIGGER_ACTIONS.has(event.action)) continue;
    const jobId = jobIdForEvent(event, vaultBySource);
    if (!jobId) continue;
    if (input?.jobId && jobId !== input.jobId) continue;
    const list = byJob.get(jobId);
    if (list) list.push(event);
    else byJob.set(jobId, [event]);
  }

  const signals: AutoHoldSignal[] = [];
  for (const [jobId, jobEvents] of byJob) {
    jobEvents.sort((a, b) => at(a) - at(b));
    const match = firstMatch(jobEvents, now);
    if (!match) continue;

    const holds = await openHoldsForJob(jobId, orgIdOf(jobEvents, vaultBySource, jobId));
    const firedAt = new Date(at(match.evidence[match.evidence.length - 1]) || now).toISOString();
    signals.push({
      jobId,
      orgId: orgIdOf(jobEvents, vaultBySource, jobId),
      rule: match.rule.key,
      label: match.rule.label,
      kind: match.rule.kind,
      reason: match.rule.why,
      firedAt,
      reviewBy: new Date(now + match.rule.reviewAfterDays * DAY).toISOString(),
      evidence: match.evidence.map((event) => ({
        occurredAt: event.occurredAt,
        action: event.action,
        actor: event.actorEmail ?? event.actorLabel,
        resourceId: event.resourceId,
      })),
      heldBy: holds[0]
        ? { id: holds[0].id, caseNumber: holds[0].caseNumber, origin: holds[0].origin }
        : null,
    });
  }

  return signals.sort((a, b) => b.firedAt.localeCompare(a.firedAt)).slice(0, input?.limit ?? 200);
}

function firstMatch(
  events: UserActivityEvent[],
  now: number,
): { rule: AutoHoldRule; evidence: UserActivityEvent[] } | null {
  for (const rule of AUTO_HOLD_RULES) {
    const evidence = rule.detect(events, now);
    if (evidence?.length) return { rule, evidence };
  }
  return null;
}

function orgIdOf(
  events: UserActivityEvent[],
  vaultBySource: Map<string, LegalVaultEntry>,
  jobId: string,
): string | null {
  for (const event of events) if (event.orgId) return event.orgId;
  for (const entry of vaultBySource.values()) if (entry.jobId === jobId) return entry.orgId;
  return null;
}

/**
 * Evaluate, then freeze what fired.
 *
 * Idempotent: a job already under an open hold is counted and skipped, so
 * running this on a timer, from the desk, and off a delete all converge on
 * the same state.
 */
export async function runAutoHoldSweep(input?: {
  jobId?: string | null;
  apply?: boolean;
  now?: number;
}): Promise<AutoHoldSweep> {
  const apply = input?.apply ?? true;
  const now = input?.now ?? Date.now();
  const signals = await evaluateAutoHolds({ jobId: input?.jobId ?? null, now });
  const opened: LegalHoldRecord[] = [];
  let alreadyHeld = 0;

  for (const signal of signals) {
    if (signal.heldBy) {
      alreadyHeld += 1;
      continue;
    }
    if (!apply) continue;
    try {
      const hold = await openJobLegalHold({
        orgId: signal.orgId ?? '',
        jobId: signal.jobId,
        kind: signal.kind,
        reason: signal.reason,
        caseNumber: autoCaseNumber(signal),
        title: `Automatic hold · ${signal.label}`,
        origin: 'automatic',
        autoRule: signal.rule,
        reviewBy: signal.reviewBy,
        createdBy: null,
      });
      opened.push(hold);
      signal.heldBy = { id: hold.id, caseNumber: hold.caseNumber, origin: hold.origin };
      await recordUserAction({
        orgId: signal.orgId,
        actorLabel: 'Atmosphere · automatic preservation',
        action: 'legal.auto_hold_opened',
        resourceType: 'job',
        resourceId: signal.jobId,
        detail: {
          holdId: hold.id,
          rule: signal.rule,
          caseNumber: hold.caseNumber,
          firedOn: signal.evidence.slice(-5),
        },
      });
    } catch (err) {
      // A 409 means somebody froze it first — that is the outcome we wanted.
      alreadyHeld += 1;
      if (!(err instanceof Error) || !/already on legal hold/i.test(err.message)) {
        console.warn('[legal] auto hold failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  return {
    ranAt: new Date(now).toISOString(),
    jobsEvaluated: signals.length,
    signals,
    opened,
    alreadyHeld,
    applied: apply,
  };
}

function autoCaseNumber(signal: AutoHoldSignal): string {
  const job = signal.jobId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const stamp = signal.firedAt.replace(/[^0-9]/g, '').slice(0, 14);
  return `AUTO-${job}-${stamp}`;
}

/**
 * Automatic holds nobody has looked at yet.
 *
 * Past `reviewBy` is a queue, not an expiry — the hold stays shut until a
 * person releases it with a reason.
 */
export function unreviewedAutoHolds(
  holds: LegalHoldRecord[],
  now = Date.now(),
): LegalHoldRecord[] {
  return holds.filter(
    (hold) =>
      hold.origin === 'automatic' &&
      hold.status === 'open' &&
      hold.reviewBy != null &&
      Date.parse(hold.reviewBy) <= now,
  );
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = Number(process.env.AUTO_HOLD_DEBOUNCE_MS ?? 15_000);
const dirtyJobs = new Set<string>();
let timer: NodeJS.Timeout | null = null;

/** Off by default in tests, so a sweep never races the assertions. */
function liveSweepEnabled(): boolean {
  return process.env.AUTO_HOLD_LIVE !== 'off' && process.env.NODE_ENV !== 'test';
}

/**
 * Called from the activity monitor after a hold-relevant action.
 *
 * Debounced per process: a customer clearing out six clips in a row queues
 * one sweep, not six. Never throws into the request that triggered it.
 */
export function noteAutoHoldSignal(event: {
  action: string;
  jobId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  path?: string | null;
  detail?: unknown;
}): void {
  if (!AUTO_HOLD_TRIGGER_ACTIONS.has(event.action)) return;
  if (!liveSweepEnabled()) return;

  const jobId =
    event.jobId ??
    (event.resourceType === 'job' ? event.resourceId ?? null : null) ??
    ((event.detail as { jobId?: unknown } | null)?.jobId as string | undefined) ??
    jobIdFromPath(event.path) ??
    null;
  // No job on the row is not a reason to skip: the vault can still resolve it
  // during the sweep. A null here just means "sweep everything recent".
  dirtyJobs.add(jobId ?? '*');

  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const jobs = [...dirtyJobs];
    dirtyJobs.clear();
    const wide = jobs.includes('*');
    void (async () => {
      try {
        if (wide) await runAutoHoldSweep({ apply: true });
        else for (const jobId of jobs) await runAutoHoldSweep({ jobId, apply: true });
      } catch (err) {
        console.warn('[legal] auto hold sweep failed:', err instanceof Error ? err.message : err);
      }
    })();
  }, DEBOUNCE_MS);
  timer.unref?.();
}

function jobIdFromPath(path?: string | null): string | null {
  const match = path?.match(
    /\/api\/operations\/shared\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i,
  );
  return match?.[1] ?? null;
}

/** Tests drain the debounce queue without waiting on a timer. */
export function resetAutoHoldQueueForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirtyJobs.clear();
}

// ---------------------------------------------------------------------------
// Scheduled sweep
// ---------------------------------------------------------------------------

/**
 * The floor under the live path.
 *
 * The debounced trigger covers anything that arrives through the API. This
 * covers everything else — a signal that landed while the process was
 * restarting, a rule whose threshold was crossed by the passage of time
 * rather than by a request, an instance that never saw the traffic. Same
 * sweep, same idempotence, so the two can overlap without consequence.
 */
const SWEEP_INTERVAL_MS = Number(process.env.AUTO_HOLD_SWEEP_MS ?? 60 * 60 * 1000);

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

export function startAutoHoldScheduler(): void {
  if (sweepTimer || !liveSweepEnabled()) return;
  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void runAutoHoldSweep({ apply: true })
      .then((sweep) => {
        if (sweep.opened.length) {
          console.log(
            `[legal] automatic preservation froze ${sweep.opened.length} job(s): ` +
              sweep.opened.map((hold) => `${hold.caseNumber} (${hold.autoRule})`).join(', '),
          );
        }
      })
      .catch((err: unknown) => {
        console.warn('[legal] scheduled auto hold sweep failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function stopAutoHoldScheduler(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
