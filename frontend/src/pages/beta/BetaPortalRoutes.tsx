/**
 * Route guards for the Beta Portal.
 *
 * These decide what to RENDER; the API and database re-check scope on every
 * call, so editing the URL cannot leak internal sheets.
 */

import { Navigate, useParams } from 'react-router-dom';
import { useAnalyticsAccess } from '../../hooks/useAnalytics';
import { AnalyticsLoading, type BetaTab } from './BetaPortalShell';
import { BetaPortalPage } from './BetaPortalPage';

const VALID_TABS: BetaTab[] = ['board', 'growth', 'customers', 'models', 'product'];

export function BetaPortalRoute() {
  const { access, loading } = useAnalyticsAccess();
  const { tab: rawTab } = useParams<{ tab?: string }>();

  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;

  const tab = (VALID_TABS.includes(rawTab as BetaTab) ? rawTab : 'board') as BetaTab;

  // Investor-scope staff who deep-link an internal tab land on Board.
  if (
    access.scope !== 'internal' &&
    (tab === 'customers' || tab === 'models' || tab === 'product')
  ) {
    return <Navigate to="/beta/board" replace />;
  }

  return <BetaPortalPage scope={access.scope} tab={tab} />;
}

/** Legacy /analytics → Beta Portal (internal or investor landing). */
export function LegacyAnalyticsRedirect() {
  const { access, loading } = useAnalyticsAccess();
  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;
  if (access.scope === 'internal') return <Navigate to="/beta/product" replace />;
  return <Navigate to="/beta/board" replace />;
}

/** Legacy /analytics/investor → Board tab. */
export function LegacyInvestorRedirect() {
  const { access, loading } = useAnalyticsAccess();
  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;
  return <Navigate to="/beta/board" replace />;
}

function NoAccess() {
  return (
    <div className="grid min-h-screen place-items-center bg-paper-100 px-6">
      <div className="max-w-md rounded-xl glass-card px-8 py-10 text-center shadow-card">
        <h1 className="text-xl font-semibold text-ink-900">Beta Portal is restricted</h1>
        <p className="mt-2 text-sm text-ink-600">
          Company-wide growth and revenue figures are limited to people who have been granted
          access. Ask an Atmosphere administrator if you need it.
        </p>
        <a
          href="/operations"
          className="mt-6 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
        >
          Back to Atmosphere
        </a>
      </div>
    </div>
  );
}
