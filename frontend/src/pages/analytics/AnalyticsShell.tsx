/**
 * Chrome shared by both dashboards: header, the single filter row, the export
 * control, and the loading/error/empty states.
 *
 * The filter row sits ABOVE everything it scopes — one range, every card
 * re-rendering against the same slice. Per-card filters would let two cards on
 * the same screen disagree about what "this month" means.
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
  /** Link to the sibling dashboard, when the viewer is allowed both. */
  otherView?: { to: string; label: string };
  children: ReactNode;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="cx-aurora min-h-screen bg-ink-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-4">
          <Logo className="text-white" />
          <span className="hidden rounded-full border border-white/10 bg-ink-700/60 px-2.5 py-0.5 text-xs font-medium text-gray-400 sm:inline">
            {viewLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {otherView && (
            <Link
              to={otherView.to}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
            >
              {otherView.label}
            </Link>
          )}
          {scope === 'internal' && (
            <Link
              to="/admin"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-500/20"
            >
              Support portal
            </Link>
          )}
          <button
            onClick={() => navigate('/dashboard')}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
          >
            Back to app
          </button>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-sm text-gray-200 transition hover:bg-ink-600"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-gray-400">{strapline}</p>
          </div>
          <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Download everything (Excel)" />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <RangeFilter value={preset} onChange={onPresetChange} />
          <p className="flex items-center gap-2 text-xs text-gray-600">
            {refreshing && <SpinnerIcon className="animate-spin" width={12} height={12} />}
            {generatedAt
              ? `Data as of ${new Date(generatedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : 'Loading…'}
          </p>
        </div>

        {/* Hold the previous render at reduced opacity on refetch — no skeleton
            flash, no layout jump. */}
        <div
          className={`transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}
        >
          {children}
        </div>

        <footer className="mt-14 border-t border-white/10 pt-6 text-xs text-gray-600">
          <p>
            {scope === 'internal'
              ? 'Internal view — includes customer names and unit economics. Do not forward outside Atmosphere.'
              : 'Investor view — aggregate figures only. No customer names or per-account detail are included.'}
          </p>
          <p className="mt-1">
            Definitions for every metric are on the “Definitions” sheet of the Excel export.
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
      className="grid min-h-screen place-items-center bg-ink-900 text-brand-300"
    >
      <SpinnerIcon className="animate-spin" width={28} height={28} />
      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}

export function AnalyticsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-10 rounded-xl border border-white/10 bg-ink-800/60 px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-200">Could not load analytics</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-500">{message}</p>
      <button
        onClick={onRetry}
        className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
      >
        Try again
      </button>
    </div>
  );
}
