import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type JobScopeItem, type ProgressShareGuestView, type SharedJobRecord } from '../lib/api';
import { exchangeShareToken, guestPathAfterExchange } from '../lib/shareExchange';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import { JobFileAskChrome } from '../components/JobFileAskChrome';
import { JobProgressDashboard } from '../components/shared/JobProgressDashboard';

/**
 * Read-only job file for third parties — homeowners, attorneys, banks,
 * insurance companies. The token in the URL is the credential; no login.
 * They see the brief, do-nots, scope, and every recording on the file,
 * and can Ask the same file. The emailed Ask link opens ?ask=1.
 */

export function JobProgressGuestPage() {
  const { token = '' } = useParams();
  const [searchParams] = useSearchParams();
  const openAsk = searchParams.get('ask') === '1';
  const [view, setView] = useState<ProgressShareGuestView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void exchangeShareToken('progress', token).then((ok) => {
      if (!ok || typeof window === 'undefined') return;
      const next = guestPathAfterExchange('progress', window.location.search);
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState(window.history.state, '', next);
      }
    });
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.progressShareGuest(token);
        if (!cancelled) {
          setView(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not open this job file.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const exclusions = useMemo(
    () => (view?.scope ?? []).filter((item) => item.state === 'excluded'),
    [view],
  );

  const guestRecord = useMemo((): SharedJobRecord | null => {
    if (!view?.job) return null;
    return {
      job: view.job,
      brief: view.brief ?? null,
      revisions: [],
      currentRevision: view.brief?.revision ?? null,
      parties: [],
      scope: view.scope ?? [],
      money: { approved: 0, pending: 0, unpricedApprovals: 0 },
      messages: [],
      risks: [],
    };
  }, [view]);

  if (!view && !error) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (error || !view || !view.job) {
    return (
      <div className="cx-aurora min-h-screen bg-paper-100">
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <Logo to={null} />
          <h1 className="mt-8 text-2xl font-semibold text-ink-900">Link unavailable</h1>
          <p className="mt-3 text-ink-600">{error ?? 'This link is not valid.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cx-aurora flex h-svh flex-col bg-paper-100">
      <header className="shrink-0 border-b border-line bg-paper-0/90 backdrop-blur">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <Logo to={null} />
          <div className="min-w-0 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
              Job file
            </p>
            <h1 className="text-lg font-semibold text-ink-900">{view.org.name}</h1>
            <p className="mt-0.5 truncate text-sm text-ink-600">
              Shared with{' '}
              <span className="font-medium text-ink-800">
                {view.share.recipientEmail ?? view.share.label}
              </span>
            </p>
          </div>
        </div>
      </header>

      <JobFileAskChrome
        jobId={view.job.id}
        initialPane={openAsk ? 'ask' : 'file'}
        file={{ record: guestRecord, proofs: view.proof }}
        ask={(question) => api.progressShareAsk(token, question)}
        loadQuestions={() => Promise.resolve({ questions: [] })}
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {view.brief && Object.keys(view.brief.facts).length > 0 && (
            <section className="rounded-xl glass-card p-5" data-testid="homeowner-job-facts">
              <h2 className="text-base font-semibold text-ink-900">On this file</h2>
              {view.brief.note && (
                <p className="mt-1 text-sm text-ink-600">{view.brief.note}</p>
              )}
              <dl className="mt-3 space-y-2">
                {Object.entries(view.brief.facts).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <dt className="w-36 shrink-0 text-xs font-medium text-ink-500">{key}</dt>
                    <dd className="min-w-0 flex-1 text-sm text-ink-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {exclusions.length > 0 && (
            <section className="rounded-xl border border-danger-200 bg-danger-50/50 px-5 py-4" data-testid="homeowner-do-nots">
              <h2 className="text-sm font-semibold text-ink-900">Do not</h2>
              <ul className="mt-2 space-y-2">
                {exclusions.map((item) => (
                  <ExclusionRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}

          <JobProgressDashboard
            jobId={view.job.id}
            record={{
              job: view.job,
              scope: view.scope ?? [],
              risks: [],
              brief: view.brief ?? null,
            }}
            readOnly
            initialProof={view.proof}
            metrics={view.progress}
            videoFetcher={(proofId) => api.progressShareVideo(token, proofId)}
            alwaysShowRecordings
          />
        </div>
      </JobFileAskChrome>
    </div>
  );
}

function ExclusionRow({ item }: { item: JobScopeItem }) {
  return (
    <li>
      <p className="text-sm font-medium text-ink-800">{item.title}</p>
      {item.reason && <p className="mt-0.5 text-xs text-ink-600">{item.reason}</p>}
    </li>
  );
}
