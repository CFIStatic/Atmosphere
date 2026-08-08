import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, type ProgressShareGuestView } from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import { JobProgressDashboard } from '../components/shared/JobProgressDashboard';

/**
 * Read-only job progress for third parties — homeowners, attorneys, banks,
 * insurance companies. The token in the URL is the credential; no login.
 */

export function JobProgressGuestPage() {
  const { token = '' } = useParams();
  const [view, setView] = useState<ProgressShareGuestView | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          setError(err instanceof ApiError ? err.message : 'Could not open this progress link.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <Logo to={null} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Job progress
              </p>
              <h1 className="text-lg font-semibold text-ink-900">{view.org.name}</h1>
            </div>
          </div>
          <p className="text-sm text-ink-600">
            Shared with <span className="font-medium text-ink-800">{view.share.label}</span>
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <JobProgressDashboard
          jobId={view.job.id}
          record={{ job: view.job, scope: [], risks: [], brief: null }}
          readOnly
          initialProof={view.proof}
          metrics={view.progress}
          videoFetcher={(proofId) => api.progressShareVideo(token, proofId)}
        />
      </main>
    </div>
  );
}
