import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, type ProgressShareGuestView } from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import { ProofOfWork } from '../components/shared/ProofOfWork';

/**
 * Read-only job progress view for third parties — homeowners, attorneys, banks,
 * insurance companies. The token in the URL is the credential; no login.
 */

function ProgressStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'success' | 'caution';
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-50/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'success'
            ? 'text-success-600'
            : tone === 'caution' && value !== '0'
              ? 'text-caution-600'
              : 'text-ink-900'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}

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

  if (error || !view) {
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

  const { progress, job, org, share } = view;

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <Logo to={null} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Job progress
              </p>
              <h1 className="text-lg font-semibold text-ink-900">{org.name}</h1>
            </div>
          </div>
          <div className="text-right text-sm text-ink-600">
            <p className="font-medium text-ink-800">Shared with {share.label}</p>
            {share.expiresAt && (
              <p className="text-xs text-ink-500">
                Expires{' '}
                {new Date(share.expiresAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-8">
        {job && (
          <div className="rounded-xl glass-card px-5 py-4">
            <h2 className="text-xl font-semibold text-ink-900">
              {job.jobNumber !== null && (
                <span className="tabular-nums text-ink-500">#{job.jobNumber} </span>
              )}
              {job.title}
            </h2>
            {job.claimNumber && (
              <p className="mt-1 text-sm text-ink-500">Claim {job.claimNumber}</p>
            )}
            <p className="mt-2 text-xs text-ink-500">
              Read-only view — scope completion, verified field days, and work history from daily
              site capture.
            </p>
          </div>
        )}

        <section className="rounded-xl glass-card p-5">
          <h2 className="text-base font-semibold text-ink-900">Work progress</h2>
          <p className="mt-1 text-xs text-ink-500">
            Scope completion and verified field days — built from daily before/after capture on site.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ProgressStat
              label="Scope complete"
              value={`${progress.scopePct}%`}
              hint={`${progress.scopeApproved} of ${progress.scopeTotal} lines approved`}
            />
            <ProgressStat
              label="Work days logged"
              value={String(progress.daysLogged)}
              hint="Days with field capture filed"
            />
            <ProgressStat
              label="Verified days"
              value={String(progress.verifiedDays)}
              hint="Passed integrity checks"
              tone="success"
            />
            <ProgressStat
              label="In progress on site"
              value={String(progress.inProgress)}
              hint="Before filmed, after still due"
              tone={progress.inProgress > 0 ? 'caution' : undefined}
            />
          </div>

          {progress.scopeTotal > 0 && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-xs text-ink-500">
                <span>Overall scope progress</span>
                <span className="tabular-nums font-medium text-ink-700">{progress.scopePct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-paper-200">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${progress.scopePct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        <ProofOfWork
          heading="Work history"
          readOnly
          initialData={view.proof}
          videoFetcher={(proofId) => api.progressShareVideo(token, proofId)}
        />
      </main>
    </div>
  );
}
