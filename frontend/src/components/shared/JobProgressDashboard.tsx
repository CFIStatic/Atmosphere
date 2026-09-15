import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type ProofResponse, type SharedJobRecord } from '../../lib/api';
import { ProofOfWork } from './ProofOfWork';
import { SpinnerIcon } from '../icons';
import {
  buildJobProgressStory,
  type StoryItem,
  type StoryTone,
} from './jobProgressStory';
import {
  buildHomeownerLiveProgressStory,
  type HomeownerLiveProgressStory,
} from './jobLiveProgressStory';
import { LiveProgressStory } from './LiveProgressStory';
import { siteLine } from '../../lib/jobFileAsk';

/**
 * Homeowner-clear job progress: a live plain-English What happened story
 * (Glance/Scan across clips), then a single Now / Done / Left brief
 * (with a compact Needs attention strip when needed).
 * Shared by office /job-progress and guest /progress/:token.
 * Does not own Ask/chat chrome.
 */

const BADGE_STYLE: Record<StoryTone, string> = {
  success: 'bg-success-50 text-success-600',
  caution: 'bg-caution-50 text-caution-600',
  danger: 'bg-danger-50 text-danger-600',
  neutral: 'bg-paper-200/60 text-ink-600',
};

function StoryRow({ item }: { item: StoryItem }) {
  return (
    <li className="px-3 py-2.5">
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

/** Tight section inside one continuous brief — not a separate glass card. */
function BriefSection({
  id,
  title,
  items,
  empty,
  footer,
}: {
  id: string;
  title: string;
  items: StoryItem[];
  empty: string;
  footer?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 py-3 first:pt-0 last:pb-0">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-ink-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
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
  showIdentity = true,
  alwaysShowRecordings = false,
  metrics: metricsOverride,
  liveStory: liveStoryOverride,
}: {
  jobId: string;
  record: Pick<SharedJobRecord, 'job' | 'scope' | 'risks' | 'brief'>;
  readOnly?: boolean;
  initialProof?: ProofResponse;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  /** When false, the parent already mounts the video catalog (office job file). */
  showProofOfWork?: boolean;
  /** Office job file already titles the page — skip the second identity block. */
  showIdentity?: boolean;
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
  /** Server-composed live story (progress share). Falls back to proof.videos. */
  liveStory?: HomeownerLiveProgressStory | null;
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

  const nextCount =
    story.next.length ||
    Math.max(
      0,
      (metricsOverride?.scopeTotal ?? 0) - (metricsOverride?.scopeApproved ?? 0),
    );

  const liveStory = useMemo(() => {
    if (liveStoryOverride) return liveStoryOverride;
    return buildHomeownerLiveProgressStory(proof?.videos ?? []);
  }, [liveStoryOverride, proof]);
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
      {showIdentity && (
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

          {loading && (
            <div className="mt-6 flex items-center gap-2 text-sm text-ink-600">
              <SpinnerIcon className="animate-spin" width={16} height={16} />
              Loading…
            </div>
          )}
        </section>
      )}

      {!showIdentity && loading && (
        <div className="flex items-center gap-2 text-sm text-ink-600">
          <SpinnerIcon className="animate-spin" width={16} height={16} />
          Loading…
        </div>
      )}

      {!loading && <LiveProgressStory story={liveStory} />}

      {!loading && (
        <div className="rounded-xl glass-card px-5 py-4 sm:px-6 divide-y divide-line">
          {story.attention.length > 0 ? (
            <div
              id="attention"
              className="scroll-mt-4 pb-3"
              data-testid="job-progress-needs-attention"
            >
              <h3 className="text-sm font-semibold text-danger-700">Needs attention</h3>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-danger-200 bg-danger-50/40">
                {story.attention.map((item) => (
                  <StoryRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          ) : null}

          <BriefSection
            id="happening"
            title="Now"
            items={story.happening}
            empty="Nothing on site."
          />

          <BriefSection
            id="happened"
            title="Done"
            items={story.happened}
            empty="Nothing finished yet."
            footer={
              showProofOfWork && !alwaysShowRecordings && (proof?.days.length ?? 0) > 5 ? (
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  {historyOpen ? 'Hide full history' : `Show all ${proof?.days.length} days`}
                </button>
              ) : null
            }
          />

          <BriefSection
            id="next"
            title="Left"
            items={nextItems}
            empty="Nothing left."
            footer={
              story.exclusionCount > 0 ? (
                <p className="mt-2 text-xs text-ink-500">
                  {story.exclusionCount} item{story.exclusionCount === 1 ? ' is' : 's are'} out of
                  scope and should not be done. See job setup for the do-not list.
                </p>
              ) : null
            }
          />
        </div>
      )}

      {showProofOfWork && (alwaysShowRecordings || historyOpen) && proof && (
        <ProofOfWork
          jobId={readOnly ? undefined : jobId}
          heading="Videos"
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
