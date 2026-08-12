/**
 * The internal dashboard.
 *
 * Built for the Atmosphere team — not investors. Shows where users actually
 * spend time, which features are hot or cold, and concrete advice on what to
 * cut and how to make the product stickier. Revenue and accounts stay below
 * that product read so the day-to-day decision is "what should we build or
 * kill," not just "how is MRR."
 */

import { useMemo, useState } from 'react';
import { useFeatureTimer } from '../../hooks/useFeatureTimer';
import { useOverview, useRange } from '../../hooks/useAnalytics';
import {
  analyticsApi,
  count,
  dateTime,
  hours,
  money,
  moneyCompact,
  percent,
  type AccountRow,
} from '../../lib/analyticsApi';
import {
  ChartCard,
  DataTable,
  DownloadExcel,
  EmptyState,
  SectionHeading,
  StatTile,
  type Column,
} from '../../components/analytics/ui';
import {
  CustomerGrowthChart,
  FeatureUsageSection,
  PlanMixSection,
  RecurringRevenueChart,
  RetentionSection,
  RevenueCollectedChart,
} from '../../components/analytics/sections';
import { ProductIntelligenceSection } from '../../components/analytics/ProductIntelligenceSection';
import { ExperimentsSection } from '../../components/analytics/ExperimentsSection';
import { AnalyticsError, AnalyticsLoading, AnalyticsShell } from './AnalyticsShell';

type AccountSort = 'mrr' | 'usage' | 'recent';

export function InternalAnalyticsPage() {
  useFeatureTimer('growth_analytics');
  const { preset, setPreset, range } = useRange('12m');
  const { data, error, loading, refreshing, reload } = useOverview(range);
  const [accountSort, setAccountSort] = useState<AccountSort>('mrr');

  const accounts = useMemo(() => {
    const rows = data?.accounts ?? [];
    const sorted = [...rows];
    if (accountSort === 'mrr') sorted.sort((a, b) => b.mrrCents - a.mrrCents);
    if (accountSort === 'usage') sorted.sort((a, b) => b.activeHours - a.activeHours);
    if (accountSort === 'recent')
      sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return sorted;
  }, [data?.accounts, accountSort]);

  if (loading && !data) return <AnalyticsLoading />;

  const summary = data?.summary;
  const revenue = summary?.revenue;
  const economics = summary?.unitEconomics;
  const intel = data?.productIntelligence ?? null;

  const churnedThisPeriod = (data?.monthly ?? []).reduce((sum, m) => sum + m.churnedOrgs, 0);
  const unusedTools = (data?.features ?? []).filter((f) => f.activeHours === 0);

  const accountColumns: Column<AccountRow>[] = [
    {
      key: 'name',
      header: 'Organization',
      render: (row) => (
        <span className="font-medium text-white">
          {row.orgName}
          {row.status !== 'active' && (
            <span className="ml-2 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
              {row.status}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <span>
          {row.planName}
          <span className="ml-1.5 text-xs text-gray-600">{row.billingInterval}</span>
        </span>
      ),
    },
    { key: 'mrr', header: 'MRR', align: 'right', render: (row) => money(row.mrrCents) },
    { key: 'arr', header: 'ARR', align: 'right', render: (row) => money(row.arrCents) },
    {
      key: 'revenue',
      header: 'Collected',
      align: 'right',
      render: (row) => money(row.revenueInRangeCents),
    },
    {
      key: 'seats',
      header: 'Seats',
      align: 'right',
      render: (row) => (
        <span>
          {count(row.members)}
          <span className="text-gray-600">/{count(row.seats)}</span>
        </span>
      ),
    },
    { key: 'hours', header: 'Hours', align: 'right', render: (row) => hours(row.activeHours) },
    {
      key: 'top',
      header: 'Most-used tool',
      render: (row) => <span className="text-gray-400">{row.topFeature ?? '—'}</span>,
    },
    {
      key: 'last',
      header: 'Last active',
      align: 'right',
      render: (row) => <span className="text-gray-400">{dateTime(row.lastActiveAt)}</span>,
    },
  ];

  return (
    <AnalyticsShell
      scope="internal"
      viewLabel="Internal view"
      title="Atmosphere — product & growth"
      strapline="Where users spend time, which tools to cut or invest in, and how to make Atmosphere stickier — for the Atmosphere team only."
      preset={preset}
      onPresetChange={setPreset}
      range={range}
      refreshing={refreshing}
      generatedAt={data?.generatedAt}
      otherView={{ to: '/analytics/investor', label: 'Investor view' }}
      extraLinks={[{ to: '/analytics/field-context', label: 'Field context' }]}
    >
      {error && <AnalyticsError message={error.message} onRetry={reload} />}

      {data && summary && revenue && (
        <>
          <SectionHeading
            title="Product intelligence"
            hint="Internal only · cut, invest, stickiness"
          />
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

          <SectionHeading title="Growth & revenue" hint="Point-in-time at each month end" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              tone="headline"
              label="MRR"
              value={moneyCompact(revenue.mrrCents)}
              delta={revenue.mrrGrowthMomPct}
              deltaLabel={`${revenue.netNewMrrCents >= 0 ? '+' : '−'}${money(
                Math.abs(revenue.netNewMrrCents),
              )} net new`}
              footnote={money(revenue.mrrCents)}
            />
            <StatTile
              tone="headline"
              label="ARR"
              value={moneyCompact(revenue.arrCents)}
              footnote={`${moneyCompact(revenue.annualContractedArrCents)} on annual contracts`}
            />
            <StatTile
              label="Paying orgs"
              value={count(summary.customers.orgsPaying)}
              delta={summary.customers.orgsGrowthMomPct}
              deltaLabel="all orgs vs last month"
              footnote={`${count(summary.customers.orgsActive)} active in this period`}
            />
            <StatTile
              label="Orgs churned"
              value={count(churnedThisPeriod)}
              footnote="Cancelled while carrying MRR"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Seats licensed"
              value={count(summary.seats.seatsLicensed)}
              delta={summary.seats.seatsGrowthMomPct}
              deltaLabel="vs last month"
              footnote={`${count(summary.seats.seatsFilled)} filled · ${percent(
                summary.seats.seatUtilizationPct,
              )} utilisation`}
            />
            <StatTile
              label="Avg monthly spend / account"
              value={moneyCompact(revenue.avgMonthlySpendPerAccountCents)}
              footnote="Subscription + usage, per 30 days"
            />
            <StatTile
              label="ARPA"
              value={moneyCompact(revenue.arpaMrrCents)}
              footnote="MRR per paying account"
            />
            <StatTile
              label="Trial pipeline"
              value={moneyCompact(revenue.trialPipelineMrrCents)}
              footnote="MRR if every trial converts"
            />
          </div>

          {economics && (
            <>
              <SectionHeading
                title="Unit economics"
                hint="AI usage billed to customers against what it cost us"
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Billed usage" value={money(economics.billedUsageCents)} />
                <StatTile label="Model cost" value={money(economics.modelCostCents)} />
                <StatTile label="Gross margin" value={money(economics.grossMarginCents)} />
                <StatTile
                  label="Gross margin %"
                  value={percent(economics.grossMarginPct)}
                  footnote="On AI usage only"
                />
              </div>
            </>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RecurringRevenueChart monthly={data.monthly} />
            <CustomerGrowthChart monthly={data.monthly} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RevenueCollectedChart monthly={data.monthly} />
            <PlanMixSection plans={data.planMix} />
          </div>

          <SectionHeading
            title="Accounts"
            hint={`${count(accounts.length)} organizations · internal only`}
          />
          <ChartCard
            title="Every customer"
            subtitle="Revenue and engagement per organization for the selected period."
            action={
              <div className="flex items-center gap-1">
                {(
                  [
                    ['mrr', 'MRR'],
                    ['usage', 'Usage'],
                    ['recent', 'Newest'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAccountSort(key)}
                    aria-pressed={accountSort === key}
                    className={`rounded-md px-2 py-1 text-xs transition ${
                      accountSort === key
                        ? 'bg-brand-600 text-white'
                        : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <DownloadExcel
                  href={analyticsApi.exportUrl(range, 'accounts')}
                  label="Excel"
                  compact
                />
              </div>
            }
          >
            <DataTable
              columns={accountColumns}
              rows={accounts}
              rowKey={(row) => row.orgId}
              maxHeight="30rem"
              empty="No organizations yet."
            />
          </ChartCard>

          <SectionHeading title="Retention" />
          <RetentionSection retention={data.retention} />

          {summary.customers.orgsTotal === 0 && (
            <div className="mt-6">
              <EmptyState
                title="No customers yet"
                body="Every metric here is live and reading from production — the charts fill in as organizations sign up and start working in Atmosphere."
              />
            </div>
          )}

          <SectionHeading title="Exports" hint="Excel, with a definitions sheet in every file" />
          <div className="flex flex-wrap gap-3">
            <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Full workbook" />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'summary')} label="Key metrics" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'monthly')} label="Monthly growth" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'features')} label="Feature usage" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'plans')} label="Plan mix" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'retention')} label="Retention" compact />
            <DownloadExcel href={analyticsApi.exportUrl(range, 'accounts')} label="Accounts" compact />
          </div>
        </>
      )}
    </AnalyticsShell>
  );
}
