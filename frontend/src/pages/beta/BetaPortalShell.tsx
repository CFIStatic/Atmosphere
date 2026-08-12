/**
 * Chrome for the Beta Portal — Atmosphere's internal analytics surface.
 *
 * Tabbed like an investor dataroom: one range filter scopes every tab, Excel
 * sits in the header, and internal-only tabs never appear for investor scope.
 */

import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { SpinnerIcon } from '../../components/icons';
import { useAuth } from '../../context/AuthContext';
import { DownloadExcel, RangeFilter, type RangePresetKey } from '../../components/analytics/ui';
import type { AnalyticsScope, RangeParams } from '../../lib/analyticsApi';
import { analyticsApi } from '../../lib/analyticsApi';

export type BetaTab = 'board' | 'growth' | 'customers' | 'models' | 'product';

const TABS: { id: BetaTab; label: string; internalOnly?: boolean }[] = [
  { id: 'board', label: 'Board' },
  { id: 'growth', label: 'Growth' },
  { id: 'customers', label: 'Customers', internalOnly: true },
  { id: 'models', label: 'Models', internalOnly: true },
  { id: 'product', label: 'Product', internalOnly: true },
];

export function BetaPortalShell({
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
  activeTab: BetaTab;
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
    <div className="cx-aurora min-h-screen bg-ink-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-4">
          <Logo className="text-white" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-white">Beta Portal</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
              {scope === 'internal' ? 'Internal analytics' : 'Investor analytics'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/operations')}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
          >
            Back to app
          </button>
          <button
            type="button"
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
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Atmosphere growth
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-gray-400">
              ARR, customers, usage, and model performance — presented for board and investor
              reviews. Every figure downloads to Excel.
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
          aria-label="Beta Portal sections"
          className="mt-6 flex flex-wrap gap-1 border-b border-white/10"
        >
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={`/beta/${tab.id}`}
              className={() => {
                const active = activeTab === tab.id;
                return `relative px-3.5 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`;
              }}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500"
                />
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pb-2">
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

        <div
          className={`transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}
        >
          {children}
        </div>

        <footer className="mt-14 border-t border-white/10 pt-6 text-xs text-gray-600">
          <p>
            {scope === 'internal'
              ? 'Beta Portal — internal view includes customer names, unit economics, and model costs. Do not forward outside Atmosphere.'
              : 'Beta Portal — investor view. Aggregate figures only; no customer names or per-account detail.'}
          </p>
          <p className="mt-1">
            Definitions for every metric are on the “Definitions” sheet of each Excel export.{' '}
            <Link to="/beta/board" className="text-gray-500 underline-offset-2 hover:underline">
              Board
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}

export { AnalyticsLoading, AnalyticsError } from '../analytics/AnalyticsShell';
