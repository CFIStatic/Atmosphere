/**
 * Deep growth analytics — retention, plan mix, user/org MoM series.
 */

import {
  analyticsApi,
  count,
  money,
  moneyCompact,
  type OverviewPayload,
  type RangeParams,
} from '../../../lib/analyticsApi';
import { DownloadExcel, SectionHeading, StatTile } from '../../../components/analytics/ui';
import {
  CustomerGrowthChart,
  PlanMixSection,
  RecurringRevenueChart,
  RetentionSection,
  RevenueCollectedChart,
} from '../../../components/analytics/sections';

export function GrowthTab({ data, range }: { data: OverviewPayload; range: RangeParams }) {
  const summary = data.summary;
  const revenue = summary.revenue;
  const churnedThisPeriod = data.monthly.reduce((sum, m) => sum + m.churnedOrgs, 0);

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          tone="headline"
          label="MRR"
          value={moneyCompact(revenue.mrrCents)}
          delta={revenue.mrrGrowthMomPct}
          deltaLabel={`${revenue.netNewMrrCents >= 0 ? '+' : '−'}${money(
            Math.abs(revenue.netNewMrrCents),
          )} net new`}
        />
        <StatTile
          tone="headline"
          label="ARR"
          value={moneyCompact(revenue.arrCents)}
          footnote={`${moneyCompact(revenue.annualContractedArrCents)} on annual contracts`}
        />
        <StatTile
          label="New orgs (period)"
          value={count(summary.customers.orgsNew)}
          delta={summary.customers.orgsGrowthMomPct}
          deltaLabel="total orgs vs last month"
        />
        <StatTile
          label="Orgs churned"
          value={count(churnedThisPeriod)}
          footnote="Cancelled while carrying MRR"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <StatTile
          label="New users (period)"
          value={count(summary.users.usersNew)}
          delta={summary.users.usersGrowthMomPct}
          deltaLabel="users vs last month"
        />
      </div>

      <SectionHeading title="Revenue & customers" hint="Month-end snapshots" />
      <div className="grid gap-4 lg:grid-cols-2">
        <RecurringRevenueChart monthly={data.monthly} />
        <CustomerGrowthChart monthly={data.monthly} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RevenueCollectedChart monthly={data.monthly} />
        <PlanMixSection plans={data.planMix} />
      </div>

      <SectionHeading title="Retention" hint="Cohort activity months after signup" />
      <RetentionSection retention={data.retention} />

      <SectionHeading title="Exports" />
      <div className="flex flex-wrap gap-3">
        <DownloadExcel href={analyticsApi.exportUrl(range, 'monthly')} label="Monthly growth" />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'retention')} label="Retention" compact />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'plans')} label="Plan mix" compact />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'summary')} label="Key metrics" compact />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Full workbook" compact />
      </div>
    </>
  );
}
