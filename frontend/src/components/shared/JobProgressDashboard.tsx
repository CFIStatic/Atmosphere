import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type ProofResponse, type SharedJobRecord } from '../../lib/api';
import { ProofOfWork } from './ProofOfWork';
import { SpinnerIcon } from '../icons';
import {
  buildJobProgressStory,
  type StoryItem,
  type StoryTone,
} from './jobProgressStory';
import { siteLine } from '../../lib/jobFileAsk';

/**
 * The job record as a timeline: what is happening now, what has already
 * happened on site, and what is still ahead.
 */

function headline(input: {
  happeningNow: number;
  daysLogged: number;
  attention: number;
  donePct: number;
}): { title: string; detail: string; tone: StoryTone } {
  if (input.attention > 0) {
    return {
      title: 'Needs your attention',
      detail: `${input.attention} item${input.attention === 1 ? '' : 's'} waiting on a decision before work can continue smoothly.`,
      tone: 'danger',
    };
  }
  if (input.happeningNow > 0) {
    return {
      title: 'Work happening on site',
      detail: 'Crews are on site or a work item is in progress. End-of-day video will land here when they finish.',
      tone: 'caution',
    };
  }
  if (input.daysLogged === 0) {
    return {
      title: 'Waiting for the first update',
      detail: 'Nothing has been filmed yet. What is queued to do is listed under What’s next.',
      tone: 'neutral',
    };
  }
  if (input.donePct >= 90) {
    return {
      title: 'Nearly complete',
      detail: `${input.donePct}% of the tracked work is done.`,
      tone: 'success',
    };
  }
  return {
    title: 'Work is moving forward',
    detail: `${input.daysLogged} day${input.daysLogged === 1 ? '' : 's'} of field updates on record.`,
    tone: 'success',
  };
}

const HEADLINE_STYLE: Record<StoryTone, string> = {
  success: 'border-success-200 bg-success-50 text-success-700',
  caution: 'border-caution-200 bg-caution-50 text-caution-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  neutral: 'border-line bg-paper-50/60 text-ink-700',
};

const BADGE_STYLE: Record<StoryTone, string> = {
  success: 'bg-success-50 text-success-600',
  caution: 'bg-caution-50 text-caution-600',
  danger: 'bg-danger-50 text-danger-600',
  neutral: 'bg-paper-200/60 text-ink-600',
};

function StoryRow({ item }: { item: StoryItem }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{item.title}</p>
          {item.detail ? <p className="mt-0.5 text-sm text-ink-700">{item.detail}</p> : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${BADGE_STYLE[item.tone]}`}
        >
          {item.badge}
        </span>
      </div>
    </li>
  );
}

function StorySection({
  id,
  title,
  hint,
  items,
  empty,
  footer,
}: {
  id: string;
  title: string;
  hint: string;
  items: StoryItem[];
  empty: string;
  footer?: ReactNode;
}) {
  return (
    <section id={id} className="rounded-xl glass-card p-5 scroll-mt-4">
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line px-4 py-6 text-center text-sm text-ink-600">
          {empty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {items.map((item) => (
            <StoryRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}

export function JobProgressDashboard({
  jobId,
  record,
  readOnly = false,
  initialProof,
  videoFetcher,
  showProofOfWork = true,
  alwaysShowRecordings = false,
  metrics: metricsOverride,
}: {
  jobId: string;
  record: Pick<SharedJobRecord, 'job' | 'scope' | 'risks' | 'brief'>;
  readOnly?: boolean;
  initialProof?: ProofResponse;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  /** When false, the parent already mounts the video catalog (office job file). */
  showProofOfWork?: boolean;
  /** Homeowner / guest shares always show every recording, not a collapsed history. */
  alwaysShowRecordings?: boolean;
  /** Guest shares supply pre-computed metrics instead of scope rows. */
  metrics?: {
    scopePct: number;
    scopeApproved: number;
    scopeTotal: number;
    daysLogged: number;
    verifiedDays: number;
    inProgress: number;
  };
}) {
  const [proof, setProof] = useState<ProofResponse | null>(initialProof ?? null);
  const [loading, setLoading] = useState(!initialProof);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (initialProof) {
      setProof(initialProof);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .jobProofs(jobId)
      .then((res) => {
        if (!cancelled) setProof(res);
      })
      .catch(() => {
        if (!cancelled) {
          setProof({
            days: [],
            counts: { days: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
            siteKnown: false,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, initialProof]);

  const story = useMemo(
    () =>
      buildJobProgressStory({
        scope: record.scope,
        days: proof?.days ?? [],
        risks: record.risks,
      }),
    [record.scope, record.risks, proof],
  );

  const daysLoggedComputed = proof?.counts.days ?? 0;
  const verifiedDaysComputed = proof?.days.filter((d) => d.payable || d.accepted).length ?? 0;
  const inProgressComputed = proof?.days.filter((d) => !d.hasAfter && d.hasBefore).length ?? 0;

  const daysLogged = metricsOverride?.daysLogged ?? daysLoggedComputed;
  const verifiedDays = metricsOverride?.verifiedDays ?? verifiedDaysComputed;
  const inProgress = metricsOverride?.inProgress ?? inProgressComputed;

  const happeningCount =
    story.happening.length > 0 ? story.happening.length : inProgress;
  const doneCount = story.trackedCount > 0 ? story.doneCount : verifiedDays;
  const nextCount =
    story.next.length ||
    Math.max(
      0,
      (metricsOverride?.scopeTotal ?? 0) - (metricsOverride?.scopeApproved ?? 0),
    );
  const trackedCount =
    story.trackedCount > 0
      ? story.trackedCount
      : metricsOverride?.scopeTotal ?? Math.max(doneCount + happeningCount + nextCount, 0);
  const donePct =
    metricsOverride && story.trackedCount === 0
      ? metricsOverride.scopePct
      : trackedCount
        ? Math.round((doneCount / trackedCount) * 100)
        : 0;

  const attentionCount = story.happening.filter((i) => i.kind === 'attention').length;
  const status = headline({
    happeningNow: happeningCount,
    daysLogged,
    attention: attentionCount,
    donePct,
  });
  const siteAddress = siteLine(record);

  const nextItems =
    story.next.length > 0
      ? story.next
      : nextCount > 0 && story.trackedCount === 0
        ? [
            {
              id: 'next:remaining',
              title: `${nextCount} work item${nextCount === 1 ? '' : 's'} still ahead`,
              detail: 'Remaining scope will list here once the full record is available.',
              badge: 'Upcoming',
              tone: 'neutral' as const,
              kind: 'scope' as const,
            },
          ]
        : [];

  return (
    <div className="space-y-4">
      <section className="rounded-xl glass-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-ink-900 sm:text-2xl">
              {record.job.jobNumber !== null && (
                <span className="tabular-nums text-ink-500">#{record.job.jobNumber} </span>
              )}
              {record.job.title}
            </h2>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-500">
              {siteAddress && <span>{siteAddress}</span>}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-ink-600">
            <SpinnerIcon className="animate-spin" width={16} height={16} />
            Loading…
          </div>
        ) : (
          <>
            <div className={`mt-5 rounded-xl border px-4 py-3.5 ${HEADLINE_STYLE[status.tone]}`}>
              <p className="text-base font-semibold">{status.title}</p>
              <p className="mt-0.5 text-sm opacity-90">{status.detail}</p>
            </div>

            {trackedCount > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-ink-800">Overall progress</span>
                  <span className="tabular-nums font-semibold text-ink-900">{donePct}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-paper-200">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${Math.max(donePct, donePct > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-500">
                  {doneCount} of {trackedCount} work items done
                  {story.exclusionCount > 0
                    ? ` · ${story.exclusionCount} out of scope`
                    : ''}
                </p>
              </div>
            )}

            <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ['happening', 'Happening now', happeningCount, happeningCount > 0 ? 'text-caution-600' : 'text-ink-900'],
                  ['happened', 'Already done', doneCount, 'text-success-600'],
                  ['next', 'Still ahead', nextItems.length || nextCount, 'text-ink-900'],
                ] as const
              ).map(([target, label, value, valueClass]) => (
                <div key={target} className="rounded-lg border border-line bg-paper-50/40 px-2 py-3">
                  <dt className="text-xs text-ink-500">
                    <a href={`#${target}`} className="hover:text-ink-800">
                      {label}
                    </a>
                  </dt>
                  <dd className={`mt-0.5 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      {!loading && (
        <>
          <StorySection
            id="happening"
            title="Happening now"
            hint="Crews on site, work in progress, and anything that needs a decision today."
            items={story.happening}
            empty="Nothing on site right now. Crews have not started filming, and nothing is waiting on a decision."
          />

          <StorySection
            id="happened"
            title="What happened"
            hint="Verified days and work that is already done."
            items={story.happened}
            empty="Nothing completed yet. Each day, crews film before they start and again when they finish — those days will show up here."
            footer={
              showProofOfWork && !alwaysShowRecordings && (proof?.days.length ?? 0) > 5 ? (
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  {historyOpen ? 'Hide full history' : `Show all ${proof?.days.length} days`}
                </button>
              ) : null
            }
          />

          <StorySection
            id="next"
            title="What’s next"
            hint="Work that has not started yet, in the order it is queued."
            items={nextItems}
            empty="Nothing left on the list — remaining work will show here if the scope grows."
            footer={
              story.exclusionCount > 0 ? (
                <p className="mt-3 text-xs text-ink-500">
                  {story.exclusionCount} item{story.exclusionCount === 1 ? ' is' : 's are'} out of
                  scope and should not be done. See job setup for the do-not list.
                </p>
              ) : null
            }
          />
        </>
      )}

      {showProofOfWork && (alwaysShowRecordings || historyOpen) && proof && (
        <ProofOfWork
          jobId={readOnly ? undefined : jobId}
          heading={alwaysShowRecordings ? 'All recordings' : 'Full work history'}
          readOnly={readOnly}
          initialData={proof}
          videoFetcher={videoFetcher}
        />
      )}
    </div>
  );
}

/** One-line job status for the picker list. */
export function jobListStatus(job: { behind: number; awaiting: number }): {
  label: string;
  tone: 'success' | 'caution' | 'danger';
} {
  const trouble = job.behind + job.awaiting;
  if (trouble > 0) return { label: 'Needs attention', tone: 'danger' };
  return { label: 'On track', tone: 'success' };
}
