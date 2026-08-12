/**
 * Beta Portal — Atmosphere's internal analytics dataroom.
 *
 * One overview fetch powers Board / Growth / Customers / Product. Models loads
 * metering separately. Tab choice is in the URL so a link lands on the right
 * surface for a board meeting or a product review.
 */

import { Navigate } from 'react-router-dom';
import { useFeatureTimer } from '../../hooks/useFeatureTimer';
import { useOverview, useRange } from '../../hooks/useAnalytics';
import { AnalyticsError, AnalyticsLoading, BetaPortalShell, type BetaTab } from './BetaPortalShell';
import { BoardTab } from './tabs/BoardTab';
import { GrowthTab } from './tabs/GrowthTab';
import { CustomersTab } from './tabs/CustomersTab';
import { ModelsTab } from './tabs/ModelsTab';
import { ProductTab } from './tabs/ProductTab';
import type { AnalyticsScope } from '../../lib/analyticsApi';

const INTERNAL_TABS: BetaTab[] = ['customers', 'models', 'product'];

export function BetaPortalPage({
  scope,
  tab,
}: {
  scope: AnalyticsScope;
  tab: BetaTab;
}) {
  useFeatureTimer('growth_analytics');
  const { preset, setPreset, range } = useRange('12m');
  const { data, error, loading, refreshing, reload } = useOverview(range);

  if (INTERNAL_TABS.includes(tab) && scope !== 'internal') {
    return <Navigate to="/beta/board" replace />;
  }

  if (loading && !data && tab !== 'models') return <AnalyticsLoading />;

  return (
    <BetaPortalShell
      scope={scope}
      activeTab={tab}
      preset={preset}
      onPresetChange={setPreset}
      range={range}
      refreshing={refreshing}
      generatedAt={data?.generatedAt}
    >
      {error && tab !== 'models' && (
        <AnalyticsError message={error.message} onRetry={reload} />
      )}

      {tab === 'models' && <ModelsTab range={range} />}

      {data && tab === 'board' && <BoardTab data={data} range={range} />}
      {data && tab === 'growth' && <GrowthTab data={data} range={range} />}
      {data && tab === 'customers' && <CustomersTab data={data} range={range} />}
      {data && tab === 'product' && <ProductTab data={data} range={range} />}
    </BetaPortalShell>
  );
}
