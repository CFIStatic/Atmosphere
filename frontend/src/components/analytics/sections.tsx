/**
 * The chart blocks shared by both dashboards.
 *
 * The investor and internal views differ in what they may show, not in how the
 * same number is drawn — so the shared shapes live here and each page composes
 * them with its own emphasis and copy.
 */

import { useMemo } from 'react';
import {
  count,
  hours,
  money,
  moneyCompact,
  monthLabel,
  percent,
  shortMonthLabel,
  type FeatureRow,
  type MonthlyRow,
  type PlanMixRow,
  type RetentionRow,
} from '../../lib/analyticsApi';
import { METRIC_COLOR } from './palette';
import { ColumnChart, HBarChart, Legend, RetentionGrid, TimeSeriesChart } from './charts';
import { ChartCard, DataTable, type Column } from './ui';

/* ------------------------------------------------------------------ growth */

export function RecurringRevenueChart({ monthly }: { monthly: MonthlyRow[] }) {
  const labels = monthly.map((m) => shortMonthLabel(m.month));

  const table: Column<MonthlyRow>[] = [
    { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
    { key: 'mrr', header: 'MRR', align: 'right', render: (r) => money(r.mrrCents) },
    { key: 'arr', header: 'ARR', align: 'right', render: (r) => money(r.arrCents) },
    {
      key: 'growth',
      header: 'Growth',
      align: 'right',
      render: (r) => (r.mrrGrowthPct === null ? '—' : percent(r.mrrGrowthPct)),
    },
  ];

  return (
    <ChartCard
      title="Recurring revenue"
      subtitle="MRR at the end of each month. ARR is this figure × 12."
      table={<DataTable columns={table} rows={monthly} rowKey={(r) => r.month} maxHeight="18rem" />}
    >
      <TimeSeriesChart
        labels={labels}
        ariaLabel="Monthly recurring revenue over time"
        formatTick={(value) => moneyCompact(value)}
        series={[
          {
            key: 'mrr',
            label: 'MRR',
            color: METRIC_COLOR.mrr,
            values: monthly.map((m) => m.mrrCents),
            format: (value) => money(value),
          },
        ]}
      />
    </ChartCard>
  );
}

export function CustomerGrowthChart({ monthly }: { monthly: MonthlyRow[] }) {
  const labels = monthly.map((m) => shortMonthLabel(m.month));

  // Users and seats are both headcounts, so they share one axis honestly.
  const series = [
    {
      key: 'users',
      label: 'Users',
      color: METRIC_COLOR.users,
      values: monthly.map((m) => m.totalUsers),
      format: (value: number) => `${count(value)} users`,
    },
    {
      key: 'seats',
      label: 'Seats licensed',
      color: METRIC_COLOR.seats,
      values: monthly.map((m) => m.seats),
      format: (value: number) => `${count(value)} seats`,
    },
  ];

  const table: Column<MonthlyRow>[] = [
    { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
    { key: 'users', header: 'Users', align: 'right', render: (r) => count(r.totalUsers) },
    { key: 'new', header: 'New users', align: 'right', render: (r) => count(r.newUsers) },
    { key: 'seats', header: 'Seats', align: 'right', render: (r) => count(r.seats) },
    { key: 'orgs', header: 'Orgs', align: 'right', render: (r) => count(r.totalOrgs) },
  ];

  return (
    <ChartCard
      title="Users and seats"
      subtitle="Cumulative linked accounts against licensed seats."
      legend={<Legend series={series.map((s) => ({ label: s.label, color: s.color }))} />}
      table={<DataTable columns={table} rows={monthly} rowKey={(r) => r.month} maxHeight="18rem" />}
    >
      <TimeSeriesChart
        labels={labels}
        series={series}
        ariaLabel="Users and licensed seats over time"
        formatTick={(value) => count(Math.round(value))}
      />
    </ChartCard>
  );
}

export function RevenueCollectedChart({ monthly }: { monthly: MonthlyRow[] }) {
  const labels = monthly.map((m) => shortMonthLabel(m.month));

  const table: Column<MonthlyRow>[] = [
    { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
    { key: 'total', header: 'Collected', align: 'right', render: (r) => money(r.revenueCents) },
    {
      key: 'sub',
      header: 'Subscriptions',
      align: 'right',
      render: (r) => money(r.subscriptionRevenueCents),
    },
    { key: 'credits', header: 'Credits', align: 'right', render: (r) => money(r.creditRevenueCents) },
  ];

  return (
    <ChartCard
      title="Revenue collected"
      subtitle="Cash from succeeded payments each month — subscriptions plus credit top-ups."
      table={<DataTable columns={table} rows={monthly} rowKey={(r) => r.month} maxHeight="18rem" />}
    >
      <ColumnChart
        labels={labels}
        values={monthly.map((m) => m.revenueCents)}
        color={METRIC_COLOR.revenue}
        ariaLabel="Revenue collected each month"
        format={(value) => money(value)}
        formatTick={(value) => moneyCompact(value)}
      />
    </ChartCard>
  );
}

/* ----------------------------------------------------------------- features */

export function FeatureUsageSection({
  features,
  showAiColumn = false,
}: {
  features: FeatureRow[];
  showAiColumn?: boolean;
}) {
  const used = features.filter((f) => f.activeHours > 0);
  const unused = features.filter((f) => f.activeHours === 0);
  // Both cards are slices of the same measure, so they share one scale.
  const peakHours = Math.max(0, ...features.map((f) => f.activeHours));
  // The bottom of the ranking is the point of this section, so the least-used
  // list always includes never-opened tools rather than dropping them.
  const leastUsed = [...features].sort((a, b) => a.activeHours - b.activeHours).slice(0, 5);

  const table: Column<FeatureRow>[] = [
    { key: 'rank', header: '#', align: 'right', render: (r) => r.timeRank },
    { key: 'label', header: 'Tool', render: (r) => r.label },
    { key: 'area', header: 'Area', render: (r) => <span className="text-ink-500">{r.area}</span> },
    { key: 'hours', header: 'Hours', align: 'right', render: (r) => hours(r.activeHours) },
    { key: 'share', header: 'Share', align: 'right', render: (r) => percent(r.sharePct) },
    { key: 'sessions', header: 'Sessions', align: 'right', render: (r) => count(r.sessions) },
    {
      key: 'avg',
      header: 'Avg session',
      align: 'right',
      render: (r) => (r.sessions > 0 ? `${r.avgSessionMinutes.toFixed(1)} min` : '—'),
    },
    { key: 'users', header: 'Users', align: 'right', render: (r) => count(r.users) },
    ...(showAiColumn
      ? [
          {
            key: 'ai',
            header: 'AI requests',
            align: 'right' as const,
            render: (r: FeatureRow) => count(r.aiRequests),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Most-used tools"
        subtitle="Ranked by foreground time spent in the product."
        table={
          <DataTable columns={table} rows={features} rowKey={(r) => r.featureKey} maxHeight="20rem" />
        }
      >
        {used.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500">
            No tool usage recorded in this period yet.
          </p>
        ) : (
          <HBarChart
            ariaLabel="Tools ranked by hours spent"
            color={METRIC_COLOR.usage}
            items={used.slice(0, 8).map((f) => ({
              key: f.featureKey,
              label: f.label,
              sublabel: f.area,
              value: f.activeHours,
              display: `${hours(f.activeHours)} · ${percent(f.sharePct, 0)}`,
            }))}
          />
        )}
      </ChartCard>

      <ChartCard
        title="Least-used tools"
        subtitle={`${
          unused.length > 0
            ? `${unused.length} ${unused.length === 1 ? 'tool has' : 'tools have'} no recorded time.`
            : 'Every tool saw some use.'
        } Same scale as the chart alongside.`}
        table={
          <DataTable
            columns={table}
            rows={[...features].sort((a, b) => a.activeHours - b.activeHours)}
            rowKey={(r) => r.featureKey}
            maxHeight="20rem"
          />
        }
      >
        <HBarChart
          ariaLabel="Tools with the least time spent"
          // Same measure as the chart alongside, so the same colour: a hue
          // change here would imply these are a different quantity.
          color={METRIC_COLOR.usage}
          maxValue={peakHours}
          items={leastUsed.map((f) => ({
            key: f.featureKey,
            label: f.label,
            sublabel: f.area,
            value: f.activeHours,
            display: hours(f.activeHours),
            emptyNote: 'not opened',
          }))}
        />
      </ChartCard>
    </div>
  );
}

/* ----------------------------------------------------------------- plan mix */

export function PlanMixSection({ plans }: { plans: PlanMixRow[] }) {
  const table: Column<PlanMixRow>[] = [
    { key: 'plan', header: 'Plan', render: (r) => r.planName },
    {
      key: 'interval',
      header: 'Billing',
      render: (r) => <span className="capitalize text-ink-500">{r.billingInterval}</span>,
    },
    { key: 'orgs', header: 'Orgs', align: 'right', render: (r) => count(r.orgs) },
    { key: 'seats', header: 'Seats', align: 'right', render: (r) => count(r.seats) },
    { key: 'mrr', header: 'MRR', align: 'right', render: (r) => money(r.mrrCents) },
    { key: 'arr', header: 'ARR', align: 'right', render: (r) => money(r.arrCents) },
    { key: 'share', header: 'Share', align: 'right', render: (r) => percent(r.mrrSharePct) },
  ];

  return (
    <ChartCard
      title="Plan mix"
      subtitle="Where recurring revenue comes from."
      table={
        <DataTable
          columns={table}
          rows={plans}
          rowKey={(r) => `${r.planCode}-${r.billingInterval}`}
        />
      }
    >
      {plans.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">No subscriptions yet.</p>
      ) : (
        <HBarChart
          ariaLabel="Recurring revenue by plan"
          // This is MRR, split by plan — the same entity the MRR chart shows.
          color={METRIC_COLOR.mrr}
          items={plans.map((p) => ({
            key: `${p.planCode}-${p.billingInterval}`,
            label: `${p.planName}`,
            sublabel: `${p.billingInterval} · ${count(p.orgs)} org${p.orgs === 1 ? '' : 's'}`,
            value: p.mrrCents,
            display: `${moneyCompact(p.mrrCents)}/mo`,
            emptyNote: 'no MRR',
          }))}
        />
      )}
    </ChartCard>
  );
}

/* ---------------------------------------------------------------- retention */

export function RetentionSection({ retention }: { retention: RetentionRow[] }) {
  const cohorts = useMemo(() => {
    const byMonth = new Map<string, { label: string; size: number; cells: (number | null)[] }>();
    for (const row of retention) {
      const existing = byMonth.get(row.cohortMonth) ?? {
        label: monthLabel(row.cohortMonth),
        size: row.cohortSize,
        cells: [],
      };
      existing.cells[row.monthOffset] = row.retentionPct;
      byMonth.set(row.cohortMonth, existing);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, value]) => value);
  }, [retention]);

  const table: Column<RetentionRow>[] = [
    { key: 'cohort', header: 'Cohort', render: (r) => monthLabel(r.cohortMonth) },
    { key: 'size', header: 'Orgs', align: 'right', render: (r) => count(r.cohortSize) },
    { key: 'offset', header: 'Month', align: 'right', render: (r) => `M${r.monthOffset}` },
    { key: 'active', header: 'Active', align: 'right', render: (r) => count(r.activeOrgs) },
    { key: 'pct', header: 'Retained', align: 'right', render: (r) => percent(r.retentionPct) },
  ];

  return (
    <ChartCard
      title="Cohort retention"
      subtitle="Of the orgs that signed up in a month, the share still active later. Values are percentages."
      table={
        <DataTable
          columns={table}
          rows={retention}
          rowKey={(r) => `${r.cohortMonth}-${r.monthOffset}`}
          maxHeight="20rem"
        />
      }
    >
      {cohorts.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">
          Not enough history to show cohorts yet.
        </p>
      ) : (
        <RetentionGrid cohorts={cohorts} />
      )}
    </ChartCard>
  );
}
