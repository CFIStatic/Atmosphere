import { Link } from 'react-router-dom';
import { useOverview } from '../hooks/useOverview';
import { useAuth } from '../context/AuthContext';
import { canSeeAccounts } from '../lib/access';
import { count, hours, money, moneyCompact, monthLabel, percent, shortDate } from '../lib/format';
import {
  Delta,
  ErrorLine,
  Fn,
  Footnotes,
  KpiStrip,
  LineChart,
  Loading,
  PageHeader,
  Section,
} from '../components/report';
import { EmptyState } from '../components/ui';
import { DownloadButton } from '../components/DownloadButton';
import { centsToUsd } from '../lib/excel';

export function GrowthPage() {
  const { access } = useAuth();
  const { data, error, loading, reload } = useOverview();
  const summary = data?.summary;
  const revenue = summary?.revenue;
  const asOfDate = shortDate(data?.generatedAt ?? null);

  if (loading && !data) return <Loading label="Loading revenue" />;

  return (
    <div>
      <PageHeader
        eyebrow="Growth & revenue"
        title="Revenue & customers"
        subtitle="Recurring revenue, paying organizations and seats from billing events. Trailing twelve months."
        asOfValue={data?.generatedAt ?? null}
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      {summary && revenue && (
        <>
          <KpiStrip
            download={{ table: 'revenue-headline-figures' }}
            items={[
              {
                label: 'MRR',
                unit: `USD, as of ${asOfDate}`,
                value: moneyCompact(revenue.mrrCents),
                raw: centsToUsd(revenue.mrrCents),
                rawType: 'usd',
                delta: <Delta value={revenue.mrrGrowthMomPct} />,
                comparison: 'vs prior month',
              },
              {
                label: 'ARR',
                unit: `USD, MRR × 12, as of ${asOfDate}`,
                value: moneyCompact(revenue.arrCents),
                raw: centsToUsd(revenue.arrCents),
                rawType: 'usd',
                note: `${moneyCompact(revenue.annualContractedArrCents)} on annual contracts`,
              },
              {
                label: 'Net new MRR',
                unit: 'USD, this month',
                value: moneyCompact(revenue.netNewMrrCents),
                raw: centsToUsd(revenue.netNewMrrCents),
                rawType: 'usd',
              },
              {
                label: 'Paying organizations',
                unit: `count, as of ${asOfDate}`,
                value: count(summary.customers.orgsPaying),
                raw: summary.customers.orgsPaying,
                rawType: 'integer',
                delta: <Delta value={summary.customers.orgsGrowthMomPct} />,
                comparison: 'vs prior month',
              },
              {
                label: 'ARPA',
                unit: 'USD MRR per paying org',
                value: moneyCompact(revenue.arpaMrrCents),
                raw: centsToUsd(revenue.arpaMrrCents),
                rawType: 'usd',
              },
              {
                label: 'Seat utilization',
                unit: '% of licensed seats filled',
                value: percent(summary.seats.seatUtilizationPct),
                raw: summary.seats.seatUtilizationPct,
                rawType: 'percent',
                note: `${count(summary.seats.seatsFilled)} of ${count(summary.seats.seatsLicensed)} seats`,
              },
            ]}
          />

          <Section
            title="Monthly recurring revenue"
            note="USD, month end, trailing 12 months"
            actions={
              <DownloadButton
                table="mrr-by-month"
                label="monthly recurring revenue chart data"
                sheets={() => [
                  {
                    name: 'MRR by month',
                    columns: [
                      { header: 'Month', type: 'month' },
                      { header: 'MRR, USD', type: 'usd' },
                    ],
                    rows: (data.monthly ?? []).map((m) => [m.month, centsToUsd(m.mrrCents)]),
                  },
                ]}
              />
            }
          >
            <LineChart
              ariaLabel="Monthly recurring revenue by month"
              format={(v) => moneyCompact(v)}
              xLabel={monthLabel}
              series={[
                {
                  label: 'MRR',
                  primary: true,
                  points: (data.monthly ?? []).map((m) => ({ x: m.month, y: m.mrrCents })),
                },
              ]}
            />
          </Section>

          <Section
            title="Monthly detail"
            note="Organizations are counted at month end"
            actions={
              <DownloadButton
                table="revenue-monthly-detail"
                label="monthly detail"
                sheets={() => [
                  {
                    name: 'Monthly detail',
                    columns: [
                      { header: 'Month', type: 'month' },
                      { header: 'New orgs', type: 'integer' },
                      { header: 'Paying orgs', type: 'integer' },
                      { header: 'Churned', type: 'integer' },
                      { header: 'Total orgs', type: 'integer' },
                      { header: 'Active orgs', type: 'integer' },
                      { header: 'MRR, USD', type: 'usd' },
                      { header: 'ARR, USD', type: 'usd' },
                      { header: 'Collected, USD', type: 'usd' },
                      { header: 'Hours in product', type: 'number' },
                    ],
                    rows: [...(data.monthly ?? [])].reverse().map((m) => [
                      m.month,
                      m.newOrgs,
                      m.payingOrgs,
                      m.churnedOrgs,
                      m.totalOrgs,
                      m.activeOrgs,
                      centsToUsd(m.mrrCents),
                      centsToUsd(m.arrCents),
                      centsToUsd(m.revenueCents),
                      m.trackedHours,
                    ]),
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">New orgs</th>
                    <th className="num">Paying orgs</th>
                    <th className="num">Churned</th>
                    <th className="num">MRR, USD</th>
                    <th className="num">Collected, USD</th>
                    <th className="num">Hours in product</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(data.monthly ?? [])].reverse().map((m) => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month)}</td>
                      <td className="num">{count(m.newOrgs)}</td>
                      <td className="num">{count(m.payingOrgs)}</td>
                      <td className="num">{count(m.churnedOrgs)}</td>
                      <td className="num">{money(m.mrrCents)}</td>
                      <td className="num">{money(m.revenueCents)}</td>
                      <td className="num">{hours(m.trackedHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Plan mix"
            note={`Active subscriptions, as of ${asOfDate}`}
            actions={
              <DownloadButton
                table="plan-mix"
                label="plan mix"
                sheets={() => [
                  {
                    name: 'Plan mix',
                    columns: [
                      { header: 'Plan' },
                      { header: 'Plan code' },
                      { header: 'Billing' },
                      { header: 'Orgs', type: 'integer' },
                      { header: 'Seats', type: 'integer' },
                      { header: 'MRR, USD', type: 'usd' },
                      { header: 'ARR, USD', type: 'usd' },
                      { header: 'Share of MRR', type: 'percent' },
                    ],
                    rows: (data.planMix ?? []).map((plan) => [
                      plan.planName,
                      plan.planCode,
                      plan.billingInterval,
                      plan.orgs,
                      plan.seats,
                      centsToUsd(plan.mrrCents),
                      centsToUsd(plan.arrCents),
                      plan.mrrSharePct,
                    ]),
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Billing</th>
                    <th className="num">Orgs</th>
                    <th className="num">Seats</th>
                    <th className="num">MRR, USD</th>
                    <th className="num">Share of MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.planMix ?? []).map((plan) => (
                    <tr key={`${plan.planCode}-${plan.billingInterval}`}>
                      <td className="font-medium text-ink-900">{plan.planName}</td>
                      <td className="text-ink-600">{plan.billingInterval}</td>
                      <td className="num">{count(plan.orgs)}</td>
                      <td className="num">{count(plan.seats)}</td>
                      <td className="num">{money(plan.mrrCents)}</td>
                      <td className="num">{percent(plan.mrrSharePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {summary.unitEconomics && (
            <Section
              title="AI unit economics"
              note="USD, report period"
              actions={
                <DownloadButton
                  table="ai-unit-economics"
                  label="AI unit economics"
                  sheets={() => {
                    const u = summary.unitEconomics!;
                    return [
                      {
                        name: 'AI unit economics',
                        columns: [{ header: 'Measure' }, { header: 'Value', type: 'usd' }],
                        rows: [
                          ['Usage billed to customers, USD', centsToUsd(u.billedUsageCents)],
                          ['Model cost, USD', centsToUsd(u.modelCostCents)],
                          ['Gross margin, USD', centsToUsd(u.grossMarginCents)],
                          ['Gross margin, %', { value: u.grossMarginPct, type: 'percent' }],
                        ],
                      },
                    ];
                  }}
                />
              }
            >
              <div className="overflow-x-auto max-w-xl">
              <table className="report-table">
                <tbody>
                  <tr>
                    <td>Usage billed to customers<Fn n={2} /></td>
                    <td className="num">{money(summary.unitEconomics.billedUsageCents)}</td>
                  </tr>
                  <tr>
                    <td>Model cost</td>
                    <td className="num">{money(summary.unitEconomics.modelCostCents)}</td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-ink-900">Gross margin</td>
                    <td className="num font-semibold text-ink-900">
                      {money(summary.unitEconomics.grossMarginCents)}{' '}
                      <span className="font-normal text-ink-500">({percent(summary.unitEconomics.grossMarginPct)})</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </Section>
          )}

          {canSeeAccounts(access?.scope) && (
            <p className="mt-6 text-[13px] text-ink-600">
              {count(data.accounts?.length ?? 0)} named organizations.{' '}
              <Link to="/accounts" className="text-brand-600 underline-offset-2 hover:underline">
                Open organizations
              </Link>
            </p>
          )}

          {summary.customers.orgsTotal === 0 && (
            <EmptyState title="No customers yet" body="These figures read live from production and fill in as organizations sign up." />
          )}
        </>
      )}

      <Footnotes
        asOfValue={data?.generatedAt ?? null}
        notes={[
          'MRR, ARR, organizations and plan mix: org_billing_events through analytics_summary, analytics_monthly and analytics_plan_mix. ARR is MRR × 12.',
          'AI unit economics: usage_events price and cost for the report period. Billed usage is what customers are charged; model cost is the provider price. Internal scope only.',
        ]}
      />
    </div>
  );
}
