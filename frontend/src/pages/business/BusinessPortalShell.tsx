/**
 * Chrome for the Business Portal — Atmosphere's internal analytics surface.
 *
 * Same paper / glass language as the rest of the console. Tabbed like an
 * investor dataroom: one range filter scopes every tab, Excel sits in the
 * header, and internal-only tabs never appear for investor scope.
 */

import { useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { SpinnerIcon } from '../../components/icons';
import { useAuth } from '../../context/AuthContext';
import { DownloadExcel, RangeFilter, type RangePresetKey } from '../../components/analytics/ui';
import type { AnalyticsScope, RangeParams } from '../../lib/analyticsApi';
import { analyticsApi } from '../../lib/analyticsApi';

export type BusinessTab = 'board' | 'growth' | 'customers' | 'models' | 'product';

const TABS: { id: BusinessTab; label: string; internalOnly?: boolean }[] = [
  { id: 'board', label: 'Board' },
  { id: 'growth', label: 'Growth' },
  { id: 'customers', label: 'Customers', internalOnly: true },
  { id: 'models', label: 'Models', internalOnly: true },
  { id: 'product', label: 'Product', internalOnly: true },
];

export function BusinessPortalShell({
  scope,
  activeTab,
  preset,
  onPresetChange,
  range,
  refreshing,
  generatedAt,
  children,
}: {
  scope: AnalyticsScope;
  activeTab: BusinessTab;
  preset: RangePresetKey;
  onPresetChange: (key: RangePresetKey) => void;
  range: RangeParams;
  refreshing: boolean;
  generatedAt?: string;
  children: ReactNode;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const visibleTabs = TABS.filter((tab) => !tab.internalOnly || scope === 'internal');

  // Board / investor decks are always the light Atmosphere paper look —
  // never follow the console dark preference while this portal is open.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (previous) root.setAttribute('data-theme', previous);
      else root.removeAttribute('data-theme');
    };
  }, []);

  const exportDataset =
    activeTab === 'customers'
      ? 'accounts'
      : activeTab === 'models'
        ? 'models'
        : activeTab === 'product'
          ? 'features'
          : activeTab === 'growth'
            ? 'monthly'
            : 'all';

  return (
    <div className="min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/80 px-6 py-3.5 backdrop-blur sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="h-5 w-px bg-line" aria-hidden />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-ink-900">Business Portal</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                {scope === 'internal' ? 'Internal analytics' : 'Investor view'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/operations')}
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-200"
            >
              Back to app
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
            <p className="text-sm font-medium text-brand-600">Atmosphere</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
              Growth &amp; ARR
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-600">
              Board-ready recurring revenue, customers, and usage. Every figure downloads to Excel.
            </p>
          </div>
          <DownloadExcel
            href={analyticsApi.exportUrl(range, exportDataset)}
            label={
              exportDataset === 'all' ? 'Download everything (Excel)' : 'Download this tab (Excel)'
            }
          />
        </div>

        <nav
          aria-label="Business Portal sections"
          className="mt-6 flex flex-wrap gap-1 border-b border-line"
        >
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <NavLink
                key={tab.id}
                to={`/business/${tab.id}`}
                className={`relative px-3.5 py-2.5 text-sm font-medium transition ${
                  active ? 'text-ink-900' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {tab.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500"
                  />
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pb-1">
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
              ? 'Internal view — includes customer names, unit economics, and model costs. Do not forward outside Atmosphere.'
              : 'Investor view — aggregate figures only. No customer names or per-account detail.'}
          </p>
          <p className="mt-1">
            Metric definitions are on the Definitions sheet of every Excel export.
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
      <span className="sr-only">Loading Business Portal…</span>
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
