/**
 * The investor dashboard.
 *
 * Same numbers, narrower surface: aggregate growth and revenue only. There are
 * no customer names and no unit economics here — and not because the UI hides
 * them, but because the payload behind this page never contains them. The API
 * omits per-account data for investor scope and the database refuses the query
 * outright, so a screenshot, a devtools poke and a saved export all agree.
 */

import { useFeatureTimer } from '../../hooks/useFeatureTimer';
import { useOverview, useRange } from '../../hooks/useAnalytics';
import {
  analyticsApi,
  count,
  hours,
  money,
  moneyCompact,
  percent,
} from '../../lib/analyticsApi';
import { DownloadExcel, EmptyState, SectionHeading, StatTile } from '../../components/analytics/ui';
import {
  CustomerGrowthChart,
  FeatureUsageSection,
  PlanMixSection,
  RecurringRevenueChart,
  RetentionSection,
  RevenueCollectedChart,
} from '../../components/analytics/sections';
import { AnalyticsError, AnalyticsLoading, AnalyticsShell } from './AnalyticsShell';

export function InvestorAnalyticsPage({ canSeeInternal }: { canSeeInternal: boolean }) {
  useFeatureTimer('growth_analytics');
  const { preset, setPreset, range } = useRange('12m');
  const { data, error, loading, refreshing, reload } = useOverview(range);

  if (loading && !data) return <AnalyticsLoading />;

  const summary = data?.summary;
  const revenue = summary?.revenue;

  return (
    <AnalyticsShell
      scope="investor"
      viewLabel="Investor view"
      title="Atmosphere — growth"
      strapline="Recurring revenue, customer growth and product engagement. Aggregate figures only."
      preset={preset}
      onPresetChange={setPreset}
      range={range}
      refreshing={refreshing}
      generatedAt={data?.generatedAt}
      otherView={canSeeInternal ? { to: '/analytics', label: 'Internal view' } : undefined}
    >
      {error && <AnalyticsError message={error.message} onRetry={reload} />}

      {data && summary && revenue && (
        <>
          {/* Headline: the three figures an investor asks for first. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              tone="headline"
              label="ARR (annual run-rate)"
              value={moneyCompact(revenue.arrCents)}
              delta={revenue.mrrGrowthMomPct}
              deltaLabel="vs last month"
              footnote={money(revenue.arrCents)}
            />
            <StatTile
              tone="headline"
              label="MRR (monthly)"
              value={moneyCompact(revenue.mrrCents)}
              delta={revenue.mrrGrowthMomPct}
              deltaLabel={`${revenue.netNewMrrCents >= 0 ? '+' : '−'}${money(
                Math.abs(revenue.netNewMrrCents),
              )} net new`}
              footnote={money(revenue.mrrCents)}
            />
            <StatTile
              label="Paying customers"
              value={count(summary.customers.orgsPaying)}
              delta={summary.customers.orgsGrowthMomPct}
              deltaLabel="orgs vs last month"
              footnote={`${count(summary.customers.orgsTotal)} organizations in total`}
            />
            <StatTile
              label="Seats licensed"
              value={count(summary.seats.seatsLicensed)}
              delta={summary.seats.seatsGrowthMomPct}
              deltaLabel="vs last month"
              footnote={`${percent(summary.seats.seatUtilizationPct)} of seats filled`}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="ARR on annual contracts"
              value={moneyCompact(revenue.annualContractedArrCents)}
              footnote="Prepaid, hardest to churn"
            />
            <StatTile
              label="MRR billed monthly"
              value={moneyCompact(revenue.monthlyBilledMrrCents)}
              footnote="The rest of recurring revenue"
            />
            <StatTile
              label="Average monthly spend"
              value={moneyCompact(revenue.avgMonthlySpendPerAccountCents)}
              footnote="Per paying account, incl. usage"
            />
            <StatTile
              label="Trailing 12-month revenue"
              value={moneyCompact(revenue.trailing12mRevenueCents)}
              footnote="Cash collected, not run-rate"
            />
          </div>

          <SectionHeading
            title="Growth"
            hint="Point-in-time at each month end"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <RecurringRevenueChart monthly={data.monthly} />
            <CustomerGrowthChart monthly={data.monthly} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RevenueCollectedChart monthly={data.monthly} />
            <PlanMixSection plans={data.planMix} />
          </div>

          <SectionHeading
            title="Product engagement"
            hint={`${hours(summary.engagement.trackedHours)} tracked in this period`}
          />
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Active organizations"
              value={count(summary.customers.orgsActive)}
              footnote="Used a tool in this period"
            />
            <StatTile
              label="Active users"
              value={count(summary.users.usersActive)}
              footnote={`of ${count(summary.users.usersTotal)} total`}
            />
            <StatTile
              label="Hours in product"
              value={hours(summary.engagement.trackedHours)}
              footnote={`across ${count(summary.engagement.sessions)} sessions`}
            />
          </div>
          <FeatureUsageSection features={data.features} />

          <SectionHeading title="Retention" />
          <RetentionSection retention={data.retention} />

          {summary.engagement.trackedHours === 0 && (
            <div className="mt-6">
              <EmptyState
                title="Engagement tracking is live but has no data yet"
                body="Time spent in each tool is recorded from the moment the product is used. Feature charts will fill in as customers work in Atmosphere."
              />
            </div>
          )}

          <SectionHeading title="Take it with you" hint="Every figure above, as a spreadsheet" />
          <div className="flex flex-wrap gap-3">
            <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Full workbook" />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'summary')} label="Key metrics" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'monthly')} label="Monthly growth" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'features')} label="Feature usage" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'plans')} label="Plan mix" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'retention')} label="Retention" compact />
          </div>
        </>
      )}
    </AnalyticsShell>
  );
}
