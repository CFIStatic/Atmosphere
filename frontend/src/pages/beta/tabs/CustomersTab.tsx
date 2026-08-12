/**
 * Per-customer usage and revenue — internal staff only.
 */

import { useMemo, useState } from 'react';
import {
  analyticsApi,
  count,
  dateTime,
  hours,
  money,
  moneyCompact,
  percent,
  type AccountRow,
  type OverviewPayload,
  type RangeParams,
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

type AccountSort = 'mrr' | 'usage' | 'recent';

export function CustomersTab({ data, range }: { data: OverviewPayload; range: RangeParams }) {
  const [accountSort, setAccountSort] = useState<AccountSort>('mrr');
  const summary = data.summary;
  const revenue = summary.revenue;
  const economics = summary.unitEconomics;

  const accounts = useMemo(() => {
    const rows = data.accounts ?? [];
    const sorted = [...rows];
    if (accountSort === 'mrr') sorted.sort((a, b) => b.mrrCents - a.mrrCents);
    if (accountSort === 'usage') sorted.sort((a, b) => b.activeHours - a.activeHours);
    if (accountSort === 'recent')
      sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return sorted;
  }, [data.accounts, accountSort]);

  const accountColumns: Column<AccountRow>[] = [
    {
      key: 'name',
      header: 'Organization',
      render: (row) => (
        <span className="font-medium text-ink-900">
          {row.orgName}
          {row.status !== 'active' && (
            <span className="ml-2 rounded-full border border-line bg-paper-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
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
          <span className="ml-1.5 text-xs text-ink-500">{row.billingInterval}</span>
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
          <span className="text-ink-500">/{count(row.seats)}</span>
        </span>
      ),
    },
    { key: 'hours', header: 'Hours', align: 'right', render: (row) => hours(row.activeHours) },
    {
      key: 'top',
      header: 'Most-used tool',
      render: (row) => <span className="text-ink-600">{row.topFeature ?? '—'}</span>,
    },
    {
      key: 'last',
      header: 'Last active',
      align: 'right',
      render: (row) => <span className="text-ink-600">{dateTime(row.lastActiveAt)}</span>,
    },
  ];

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          tone="headline"
          label="Paying orgs"
          value={count(summary.customers.orgsPaying)}
          footnote={`${count(summary.customers.orgsActive)} active in this period`}
        />
        <StatTile
          label="Hours in product"
          value={hours(summary.engagement.trackedHours)}
          footnote={`${count(summary.engagement.sessions)} sessions`}
        />
        <StatTile
          label="Avg spend / account"
          value={moneyCompact(revenue.avgMonthlySpendPerAccountCents)}
          footnote="Per 30 days"
        />
        <StatTile
          label="Seat utilisation"
          value={percent(summary.seats.seatUtilizationPct)}
          footnote={`${count(summary.seats.seatsFilled)} / ${count(summary.seats.seatsLicensed)}`}
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

      <SectionHeading
        title="Usage by customer"
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
                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                      accountSort === key
                        ? 'bg-brand-500 text-white'
                        : 'text-ink-600 hover:bg-paper-200 hover:text-ink-900'
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

      {accounts.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No customer rows yet"
            body="Accounts appear here once organizations are onboarded and billed."
          />
        </div>
      )}
    </>
  );
}
