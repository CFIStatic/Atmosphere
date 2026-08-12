/**
 * Product intelligence — features, experiments, cut/invest advice.
 */

import {
  analyticsApi,
  count,
  hours,
  type OverviewPayload,
  type RangeParams,
} from '../../../lib/analyticsApi';
import {
  DownloadExcel,
  EmptyState,
  SectionHeading,
  StatTile,
} from '../../../components/analytics/ui';
import { FeatureUsageSection } from '../../../components/analytics/sections';
import { ProductIntelligenceSection } from '../../../components/analytics/ProductIntelligenceSection';
import { ExperimentsSection } from '../../../components/analytics/ExperimentsSection';

export function ProductTab({ data, range }: { data: OverviewPayload; range: RangeParams }) {
  const summary = data.summary;
  const intel = data.productIntelligence;
  const unusedTools = data.features.filter((f) => f.activeHours === 0);

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          tone="headline"
          label="Hours in product"
          value={hours(summary.engagement.trackedHours)}
          footnote={`${count(summary.engagement.sessions)} sessions`}
        />
        <StatTile
          label="Active users"
          value={count(summary.users.usersActive)}
          footnote={`of ${count(summary.users.usersTotal)} total`}
        />
        <StatTile
          label="Tools used"
          value={`${count(summary.engagement.featuresUsed)} / ${count(
            summary.engagement.featuresTracked,
          )}`}
          footnote={
            unusedTools.length > 0
              ? `${unusedTools.length} instrumented but untouched`
              : 'Every tool saw use'
          }
        />
        <StatTile
          label="AI requests"
          value={count(summary.engagement.aiRequests)}
          footnote="Model-backed calls in period"
        />
      </div>

      <SectionHeading
        title="Product intelligence"
        hint="Internal only · cut, invest, stickiness"
      />
      {intel ? (
        <ProductIntelligenceSection intel={intel} />
      ) : (
        <EmptyState
          title="Product intelligence unavailable"
          body="This section only loads for internal Atmosphere staff."
        />
      )}

      <SectionHeading
        title="Feature usage detail"
        hint="Every instrumented tool, ranked by foreground time"
      />
      <FeatureUsageSection features={data.features} showAiColumn />

      <SectionHeading
        title="A/B tests"
        hint="Assignments, exposures, and conversions for running experiments"
      />
      <ExperimentsSection range={range} />

      <SectionHeading title="Exports" />
      <div className="flex flex-wrap gap-3">
        <DownloadExcel href={analyticsApi.exportUrl(range, 'features')} label="Feature usage" />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Full workbook" compact />
      </div>
    </>
  );
}
