import { useEffect, useMemo, useState } from 'react';
import { api, type ProofDay, type ProofResponse, type SharedJobRecord } from '../../lib/api';
import { ProofOfWork } from './ProofOfWork';
import { SpinnerIcon } from '../icons';

/**
 * The job progress view — one plain-language story: where things stand,
 * what needs attention, and what happened on site recently.
 */

type AttentionItem = { title: string; detail: string; level: 'blocker' | 'warn' };

function formatDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function dayStatus(day: ProofDay): { label: string; tone: 'success' | 'caution' | 'danger' | 'neutral' } {
  if (day.contradicted) return { label: 'Issue found', tone: 'danger' };
  if (day.accepted || day.payable) return { label: 'Verified', tone: 'success' };
  if (day.hasBefore && !day.hasAfter) return { label: 'Still on site', tone: 'caution' };
  if (day.rejected) return { label: 'Rejected', tone: 'danger' };
  return { label: 'Being reviewed', tone: 'neutral' };
}

function headline(input: {
  scopePct: number;
  daysLogged: number;
  inProgress: number;
  attention: AttentionItem[];
}): { title: string; detail: string; tone: 'success' | 'caution' | 'danger' | 'neutral' } {
  const blockers = input.attention.filter((a) => a.level === 'blocker').length;
  if (blockers > 0) {
    return {
      title: 'Needs your attention',
      detail: `${blockers} item${blockers === 1 ? '' : 's'} waiting on a decision before work can continue smoothly.`,
      tone: 'danger',
    };
  }
  if (input.daysLogged === 0) {
    return {
      title: 'Waiting for the first update',
      detail: 'Once crews film on site, daily progress will show up here automatically.',
      tone: 'neutral',
    };
  }
  if (input.inProgress > 0) {
    return {
      title: 'Work happening on site',
      detail: `${input.inProgress} crew${input.inProgress === 1 ? ' is' : 's are'} on site — waiting for end-of-day video.`,
      tone: 'caution',
    };
  }
  if (input.scopePct >= 90) {
    return {
      title: 'Nearly complete',
      detail: `${input.scopePct}% of approved work items are done.`,
      tone: 'success',
    };
  }
  return {
    title: 'Work is moving forward',
    detail: `${input.daysLogged} day${input.daysLogged === 1 ? '' : 's'} of field updates on record.`,
    tone: 'success',
  };
}

const HEADLINE_STYLE = {
  success: 'border-success-200 bg-success-50 text-success-700',
  caution: 'border-caution-200 bg-caution-50 text-caution-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  neutral: 'border-line bg-paper-50/60 text-ink-700',
} as const;

const BADGE_STYLE = {
  success: 'bg-success-50 text-success-600',
  caution: 'bg-caution-50 text-caution-600',
  danger: 'bg-danger-50 text-danger-600',
  neutral: 'bg-paper-200/60 text-ink-600',
} as const;

export function JobProgressDashboard({
  jobId,
  record,
  readOnly = false,
  initialProof,
  videoFetcher,
  metrics: metricsOverride,
}: {
  jobId: string;
  record: Pick<SharedJobRecord, 'job' | 'scope' | 'risks' | 'brief'>;
  readOnly?: boolean;
  initialProof?: ProofResponse;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
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

  const actionable = record.scope.filter((item) => item.state !== 'excluded');
  const scopeApproved = actionable.filter((item) => item.state === 'approved').length;
  const scopePctComputed = actionable.length ? Math.round((scopeApproved / actionable.length) * 100) : 0;
  const daysLoggedComputed = proof?.counts.days ?? 0;
  const verifiedDaysComputed = proof?.days.filter((d) => d.payable || d.accepted).length ?? 0;
  const inProgressComputed = proof?.days.filter((d) => d.hasBefore && !d.hasAfter).length ?? 0;

  const scopePct = metricsOverride?.scopePct ?? scopePctComputed;
  const scopeApprovedDisplay = metricsOverride?.scopeApproved ?? scopeApproved;
  const scopeTotal = metricsOverride?.scopeTotal ?? actionable.length;
  const daysLogged = metricsOverride?.daysLogged ?? daysLoggedComputed;
  const verifiedDays = metricsOverride?.verifiedDays ?? verifiedDaysComputed;
  const inProgress = metricsOverride?.inProgress ?? inProgressComputed;

  const attention = useMemo<AttentionItem[]>(() => {
    return record.risks
      .filter((r) => r.level === 'blocker' || r.level === 'warn')
      .slice(0, 4)
      .map((r) => ({
        title: r.title,
        detail: r.action,
        level: r.level === 'blocker' ? 'blocker' : 'warn',
      }));
  }, [record.risks]);

  const status = headline({ scopePct, daysLogged, inProgress, attention });
  const recentDays = (proof?.days ?? []).slice(0, 5);
  const siteAddress = record.brief?.facts?.['Site address'] ?? record.brief?.facts?.['Site Address'];

  return (
    <div className="space-y-4">
      {/* Hero — the one thing everyone reads */}
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
              {record.job.claimNumber && <span>Claim {record.job.claimNumber}</span>}
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

            {scopeTotal > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-ink-800">Overall progress</span>
                  <span className="tabular-nums font-semibold text-ink-900">{scopePct}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-paper-200">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${Math.max(scopePct, 2)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-500">
                  {scopeApprovedDisplay} of {scopeTotal} work items approved and tracked
                </p>
              </div>
            )}

            <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-line bg-paper-50/40 px-2 py-3">
                <dt className="text-xs text-ink-500">Days on site</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-ink-900">{daysLogged}</dd>
              </div>
              <div className="rounded-lg border border-line bg-paper-50/40 px-2 py-3">
                <dt className="text-xs text-ink-500">Verified</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-success-600">{verifiedDays}</dd>
              </div>
              <div className="rounded-lg border border-line bg-paper-50/40 px-2 py-3">
                <dt className="text-xs text-ink-500">On site now</dt>
                <dd
                  className={`mt-0.5 text-2xl font-semibold tabular-nums ${
                    inProgress > 0 ? 'text-caution-600' : 'text-ink-900'
                  }`}
                >
                  {inProgress}
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {/* Attention — only when something actually needs a human */}
      {!loading && attention.length > 0 && (
        <section className="rounded-xl border border-caution-200 bg-caution-50/40 p-5">
          <h3 className="text-sm font-semibold text-caution-700">What needs attention</h3>
          <ul className="mt-3 space-y-2.5">
            {attention.map((item) => (
              <li key={item.title} className="rounded-lg border border-line bg-paper-0/80 px-3 py-2.5">
                <p className="text-sm font-medium text-ink-900">{item.title}</p>
                <p className="mt-0.5 text-xs text-ink-600">{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent work — simple timeline, not the full proof UI */}
      {!loading && (
        <section className="rounded-xl glass-card p-5">
          <h3 className="text-base font-semibold text-ink-900">Recent work on site</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Each day, crews film before they start and again when they finish.
          </p>

          {recentDays.length === 0 ? (
            <p className="mt-4 rounded-lg border border-line px-4 py-6 text-center text-sm text-ink-600">
              No field updates yet. Progress will appear here once crews start filming on site.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
              {recentDays.map((day) => {
                const badge = dayStatus(day);
                const summary = day.aiSummary ?? day.summary;
                return (
                  <li key={`${day.partyId}|${day.workDate}`} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900">
                          {formatDay(day.workDate)}
                          <span className="ml-2 font-normal text-ink-500">{day.company}</span>
                        </p>
                        <p className="mt-0.5 text-sm text-ink-700">{summary}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${BADGE_STYLE[badge.tone]}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {(proof?.days.length ?? 0) > 5 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {historyOpen ? 'Hide full history' : `Show all ${proof?.days.length} days`}
            </button>
          )}
        </section>
      )}

      {historyOpen && proof && (
        <ProofOfWork
          jobId={readOnly ? undefined : jobId}
          heading="Full work history"
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
