/**
 * Route guards for the Beta Portal.
 *
 * These decide what to RENDER; the API and database re-check scope on every
 * call, so editing the URL cannot leak internal sheets.
 */

import { Navigate, useParams } from 'react-router-dom';
import { useAnalyticsAccess } from '../../hooks/useAnalytics';
import { AnalyticsLoading } from '../analytics/AnalyticsShell';
import { BetaPortalPage } from './BetaPortalPage';
import type { BetaTab } from './BetaPortalShell';

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
    <div className="grid min-h-screen place-items-center bg-ink-900 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-white">Beta Portal is restricted</h1>
        <p className="mt-2 text-sm text-gray-400">
          Company-wide growth and revenue figures are limited to people who have been granted
          access. Ask an Atmosphere administrator if you need it.
        </p>
        <a
          href="/operations"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Back to Atmosphere
        </a>
      </div>
    </div>
  );
}
