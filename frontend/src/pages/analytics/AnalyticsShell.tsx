/**
 * Legacy analytics chrome — kept for the old Internal/Investor pages.
 * New work uses BetaPortalShell (Atmosphere paper/glass look).
 */

import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { SpinnerIcon } from '../../components/icons';
import { useAuth } from '../../context/AuthContext';
import { DownloadExcel, RangeFilter, type RangePresetKey } from '../../components/analytics/ui';
import type { AnalyticsScope, RangeParams } from '../../lib/analyticsApi';
import { analyticsApi } from '../../lib/analyticsApi';

export function AnalyticsShell({
  scope,
  viewLabel,
  title,
  strapline,
  preset,
  onPresetChange,
  range,
  refreshing,
  generatedAt,
  otherView,
  children,
}: {
  scope: AnalyticsScope;
  viewLabel: string;
  title: string;
  strapline: string;
  preset: RangePresetKey;
  onPresetChange: (key: RangePresetKey) => void;
  range: RangeParams;
  refreshing: boolean;
  generatedAt?: string;
  otherView?: { to: string; label: string };
  children: ReactNode;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/80 px-6 py-3.5 backdrop-blur sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full border border-line bg-paper-50 px-2.5 py-0.5 text-xs font-medium text-ink-600">
              {viewLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {otherView && (
              <Link
                to={otherView.to}
                className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-200"
              >
                {otherView.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => navigate('/beta/board')}
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-200"
            >
              Beta Portal
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-600">{strapline}</p>
          </div>
          <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Download everything (Excel)" />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <RangeFilter value={preset} onChange={onPresetChange} />
          <p className="flex items-center gap-2 text-xs text-ink-500">
            {refreshing && <SpinnerIcon className="animate-spin" width={12} height={12} />}
            {generatedAt
              ? `Data as of ${new Date(generatedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}`
              : 'Loading…'}
          </p>
        </div>

        <div
          className={`transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}
        >
          {children}
        </div>

        <footer className="mt-14 border-t border-line pt-6 text-xs text-ink-500">
          <p>
            {scope === 'internal'
              ? 'Internal view — includes customer names and unit economics. Do not forward outside Atmosphere.'
              : 'Investor view — aggregate figures only. No customer names or per-account detail are included.'}
          </p>
        </footer>
      </main>
    </div>
  );
}

export function AnalyticsLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-paper-100 text-brand-500"
    >
      <SpinnerIcon className="animate-spin" width={28} height={28} />
      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}

export function AnalyticsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-10 rounded-xl glass-card px-6 py-12 text-center shadow-card">
      <p className="text-sm font-semibold text-ink-900">Could not load analytics</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
      >
        Try again
      </button>
    </div>
  );
}
