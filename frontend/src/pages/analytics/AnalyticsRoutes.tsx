/**
 * Route guards for the two dashboards.
 *
 * These decide what to RENDER; they are not the security boundary. The API and
 * the database both re-check scope on every call, so a user who edits their way
 * to /analytics gets an empty shell and a 403, not data.
 */

import { Navigate } from 'react-router-dom';
import { useAnalyticsAccess } from '../../hooks/useAnalytics';
import { AnalyticsLoading } from './AnalyticsShell';
import { InternalAnalyticsPage } from './InternalAnalyticsPage';
import { InvestorAnalyticsPage } from './InvestorAnalyticsPage';
import { FieldContextPage } from '../FieldContextPage';

/** Internal dashboard: full detail. Investor-scope users are sent to their own view. */
export function InternalAnalyticsRoute() {
  const { access, loading } = useAnalyticsAccess();

  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;
  if (access.scope !== 'internal') return <Navigate to="/analytics/investor" replace />;

  return <InternalAnalyticsPage />;
}

/** Investor dashboard: available to both scopes, since internal staff present from it. */
export function InvestorAnalyticsRoute() {
  const { access, loading } = useAnalyticsAccess();

  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;

  return <InvestorAnalyticsPage canSeeInternal={access.scope === 'internal'} />;
}

/** Field Capture context — Atmosphere staff only; never a customer surface. */
export function InternalFieldContextRoute() {
  const { access, loading } = useAnalyticsAccess();

  if (loading) return <AnalyticsLoading />;
  if (!access?.scope) return <NoAccess />;
  if (access.scope !== 'internal') return <Navigate to="/analytics/investor" replace />;

  return <FieldContextPage />;
}

function NoAccess() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-900 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-white">Analytics is restricted</h1>
        <p className="mt-2 text-sm text-gray-400">
          Company-wide growth and revenue figures are limited to people who have been granted
          access. Ask an Atmosphere administrator if you need it.
        </p>
        <a
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Back to Atmosphere
        </a>
      </div>
    </div>
  );
}
