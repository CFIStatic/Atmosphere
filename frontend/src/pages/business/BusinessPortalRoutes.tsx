/**
 * Route guards for the Business Portal.
 *
 * These decide what to RENDER; the API and database re-check scope on every
 * call, so editing the URL cannot leak internal sheets.
 */

import { Navigate, useParams } from 'react-router-dom';
import { useAnalyticsAccess } from '../../hooks/useAnalytics';
import { AnalyticsLoading, type BusinessTab } from './BusinessPortalShell';
import { BusinessPortalPage } from './BusinessPortalPage';

const VALID_TABS: BusinessTab[] = ['board', 'growth', 'customers', 'models', 'product'];

export function BusinessPortalRoute() {
  const { access, loading } = useAnalyticsAccess();
  const { tab: rawTab } = useParams<{ tab?: string }>();

  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;

  const tab = (VALID_TABS.includes(rawTab as BusinessTab) ? rawTab : 'board') as BusinessTab;

  // Investor-scope staff who deep-link an internal tab land on Board.
  if (
    access.scope !== 'internal' &&
    (tab === 'customers' || tab === 'models' || tab === 'product')
  ) {
    return <Navigate to="/business/board" replace />;
  }

  return <BusinessPortalPage scope={access.scope} tab={tab} />;
}

/** Legacy /analytics → Business Portal (internal or investor landing). */
export function LegacyAnalyticsRedirect() {
  const { access, loading } = useAnalyticsAccess();
  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;
  if (access.scope === 'internal') return <Navigate to="/business/product" replace />;
  return <Navigate to="/business/board" replace />;
}

/** Legacy /analytics/investor → Board tab. */
export function LegacyInvestorRedirect() {
  const { access, loading } = useAnalyticsAccess();
  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;
  return <Navigate to="/business/board" replace />;
}

/** Legacy /beta/:tab → /business/:tab after the rename. */
export function LegacyBetaPortalRedirect() {
  const { tab: rawTab } = useParams<{ tab?: string }>();
  const tab = VALID_TABS.includes(rawTab as BusinessTab) ? rawTab : 'board';
  return <Navigate to={`/business/${tab}`} replace />;
}

function NoAccess() {
  return (
    <div className="grid min-h-screen place-items-center bg-paper-100 px-6">
      <div className="max-w-md rounded-xl glass-card px-8 py-10 text-center shadow-card">
        <h1 className="text-xl font-semibold text-ink-900">Business Portal is restricted</h1>
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
