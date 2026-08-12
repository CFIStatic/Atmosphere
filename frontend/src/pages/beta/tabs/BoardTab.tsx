/**
 * Investor / board presentation tab — the three figures first, then growth.
 */

import {
  analyticsApi,
  count,
  hours,
  money,
  moneyCompact,
  monthLabel,
  percent,
  type MonthlyRow,
  type OverviewPayload,
} from '../../../lib/analyticsApi';
import {
  ChartCard,
  DataTable,
  DownloadExcel,
  EmptyState,
  SectionHeading,
  StatTile,
  type Column,
} from '../../../components/analytics/ui';
import {
  CustomerGrowthChart,
  PlanMixSection,
  RecurringRevenueChart,
  RevenueCollectedChart,
} from '../../../components/analytics/sections';
import type { RangeParams } from '../../../lib/analyticsApi';

function arrYoyPct(monthly: MonthlyRow[]): number | null {
  if (monthly.length < 13) return null;
  const latest = monthly[monthly.length - 1];
  const yearAgo = monthly[monthly.length - 13];
  if (!yearAgo?.arrCents) return null;
  return ((latest.arrCents - yearAgo.arrCents) / yearAgo.arrCents) * 100;
}

export function BoardTab({ data, range }: { data: OverviewPayload; range: RangeParams }) {
  const summary = data.summary;
  const revenue = summary.revenue;
  const yoy = arrYoyPct(data.monthly);

  const momColumns: Column<MonthlyRow>[] = [
    { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
    { key: 'arr', header: 'ARR', align: 'right', render: (r) => money(r.arrCents) },
    { key: 'mrr', header: 'MRR', align: 'right', render: (r) => money(r.mrrCents) },
    {
      key: 'mrrGrowth',
      header: 'MoM ARR',
      align: 'right',
      render: (r) => (r.mrrGrowthPct === null ? '—' : percent(r.mrrGrowthPct)),
    },
    {
      key: 'paying',
      header: 'Paying orgs',
      align: 'right',
      render: (r) => count(r.payingOrgs),
    },
    {
      key: 'users',
      header: 'Users',
      align: 'right',
      render: (r) => count(r.totalUsers),
    },
    {
      key: 'userGrowth',
      header: 'MoM users',
      align: 'right',
      render: (r) => (r.userGrowthPct === null ? '—' : percent(r.userGrowthPct)),
    },
    {
      key: 'collected',
      header: 'Collected',
      align: 'right',
      render: (r) => money(r.revenueCents),
    },
  ];

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="ARR on annual contracts"
          value={moneyCompact(revenue.annualContractedArrCents)}
          footnote="Prepaid · hardest to churn"
        />
        <StatTile
          label="ARR year over year"
          value={yoy === null ? '—' : percent(yoy)}
          delta={yoy}
          deltaLabel="vs same month last year"
          footnote={
            yoy === null ? 'Needs 13 months of history' : money(revenue.arrCents)
          }
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Paying customers"
          value={count(summary.customers.orgsPaying)}
          delta={summary.customers.orgsGrowthMomPct}
          deltaLabel="orgs vs last month"
          footnote={`${count(summary.customers.orgsTotal)} organizations in total`}
        />
        <StatTile
          label="Active users"
          value={count(summary.users.usersActive)}
          delta={summary.users.usersGrowthMomPct}
          deltaLabel="users vs last month"
          footnote={`of ${count(summary.users.usersTotal)} total`}
        />
        <StatTile
          label="Seats licensed"
          value={count(summary.seats.seatsLicensed)}
          delta={summary.seats.seatsGrowthMomPct}
          deltaLabel="vs last month"
          footnote={`${percent(summary.seats.seatUtilizationPct)} of seats filled`}
        />
        <StatTile
          label="Trailing 12-month revenue"
          value={moneyCompact(revenue.trailing12mRevenueCents)}
          footnote="Cash collected, not run-rate"
        />
      </div>

      <SectionHeading title="Growth story" hint="Point-in-time at each month end" />
      <div className="grid gap-4 lg:grid-cols-2">
        <RecurringRevenueChart monthly={data.monthly} />
        <CustomerGrowthChart monthly={data.monthly} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RevenueCollectedChart monthly={data.monthly} />
        <PlanMixSection plans={data.planMix} />
      </div>

      <SectionHeading
        title="Month over month"
        hint="Board-ready table · same numbers as the charts"
      />
      <ChartCard
        title="MoM growth ledger"
        subtitle="ARR, customers, and users at each month end — ready to paste into a deck."
        action={
          <DownloadExcel href={analyticsApi.exportUrl(range, 'monthly')} label="Excel" compact />
        }
      >
        <DataTable
          columns={momColumns}
          rows={[...data.monthly].reverse()}
          rowKey={(r) => r.month}
          maxHeight="22rem"
          empty="No monthly history yet."
        />
      </ChartCard>

      <SectionHeading
        title="Engagement snapshot"
        hint={`${hours(summary.engagement.trackedHours)} tracked in this period`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Active organizations"
          value={count(summary.customers.orgsActive)}
          footnote="Used a tool in this period"
        />
        <StatTile
          label="Hours in product"
          value={hours(summary.engagement.trackedHours)}
          footnote={`across ${count(summary.engagement.sessions)} sessions`}
        />
        <StatTile
          label="AI requests"
          value={count(summary.engagement.aiRequests)}
          footnote="Model-backed calls in period"
        />
      </div>

      {summary.customers.orgsTotal === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No customers yet"
            body="Every metric here is live — charts fill in as organizations sign up and work in Atmosphere."
          />
        </div>
      )}

      <SectionHeading title="Exports" hint="Excel, with a definitions sheet in every file" />
      <div className="flex flex-wrap gap-3">
        <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Full workbook" />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'summary')} label="Key metrics" compact />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'monthly')} label="Monthly growth" compact />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'plans')} label="Plan mix" compact />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'retention')} label="Retention" compact />
      </div>
    </>
  );
}
