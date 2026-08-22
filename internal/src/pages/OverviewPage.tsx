import { Link } from 'react-router-dom';
import { useOverview } from '../hooks/useOverview';
import { count, hours, money, moneyCompact, percent, signedPercent } from '../lib/format';
import { canSeeAccounts } from '../lib/access';
import { useAuth } from '../context/AuthContext';
import { EmptyState, SectionHeading, Sparkline, StatTile } from '../components/ui';

export function OverviewPage() {
  const { access } = useAuth();
  const { data, error, loading, reload } = useOverview();
  const summary = data?.summary;
  const revenue = summary?.revenue;

  if (loading && !data) {
    return <p className="text-ink-500">Loading overview…</p>;
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Product & growth</h1>
          <p className="mt-1 text-sm text-ink-500">
            Live figures from the Atmosphere backend. Named accounts stay on this site, not the
            customer console.
          </p>
        </div>
        {data && (
          <p className="text-xs text-ink-500">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger-600">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      )}

      {summary && revenue && (
        <>
          <SectionHeading title="This period" hint="Trailing 12 months" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="MRR"
              value={moneyCompact(revenue.mrrCents)}
              delta={revenue.mrrGrowthMomPct}
              footnote={money(revenue.mrrCents)}
            />
            <StatTile
              label="ARR"
              value={moneyCompact(revenue.arrCents)}
              footnote={`${moneyCompact(revenue.annualContractedArrCents)} annual contracts`}
            />
            <StatTile
              label="Paying orgs"
              value={count(summary.customers.orgsPaying)}
              delta={summary.customers.orgsGrowthMomPct}
              footnote={`${count(summary.customers.orgsActive)} active`}
            />
            <StatTile
              label="Hours in product"
              value={hours(summary.engagement.trackedHours)}
              footnote={`${count(summary.engagement.sessions)} sessions`}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Users"
              value={count(summary.users.usersActive)}
              delta={summary.users.usersGrowthMomPct}
              footnote={`of ${count(summary.users.usersTotal)} total`}
            />
            <StatTile
              label="Seats filled"
              value={count(summary.seats.seatsFilled)}
              footnote={`${percent(summary.seats.seatUtilizationPct)} of ${count(summary.seats.seatsLicensed)} licensed`}
            />
            <StatTile label="ARPA" value={moneyCompact(revenue.arpaMrrCents)} footnote="MRR / paying org" />
            <StatTile
              label="Collected"
              value={moneyCompact(revenue.collectedInRangeCents)}
              footnote={`T12M ${moneyCompact(revenue.trailing12mRevenueCents)}`}
            />
          </div>

          {summary.unitEconomics && (
            <>
              <SectionHeading title="Unit economics" hint="AI usage billed vs model cost" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Billed usage" value={money(summary.unitEconomics.billedUsageCents)} />
                <StatTile label="Model cost" value={money(summary.unitEconomics.modelCostCents)} />
                <StatTile label="Gross margin" value={money(summary.unitEconomics.grossMarginCents)} />
                <StatTile label="Gross margin %" value={percent(summary.unitEconomics.grossMarginPct)} />
              </div>
            </>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Sparkline
              label="Monthly recurring revenue"
              values={(data.monthly ?? []).map((row) => row.mrrCents)}
            />
            <Sparkline
              label="Organizations"
              values={(data.monthly ?? []).map((row) => row.totalOrgs)}
            />
          </div>

          <SectionHeading title="Plan mix" />
          <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
            <table className="w-full text-sm">
              <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3 text-right">Orgs</th>
                  <th className="px-4 py-3 text-right">Seats</th>
                  <th className="px-4 py-3 text-right">MRR</th>
                  <th className="px-4 py-3 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {(data.planMix ?? []).map((plan) => (
                  <tr key={`${plan.planCode}-${plan.billingInterval}`} className="border-t border-line">
                    <td className="px-4 py-3">
                      {plan.planName}
                      <span className="ml-2 text-xs text-ink-500">{plan.billingInterval}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{count(plan.orgs)}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(plan.seats)}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(plan.mrrCents)}</td>
                    <td className="px-4 py-3 text-right font-mono">{percent(plan.mrrSharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.productIntelligence && (
            <>
              <SectionHeading
                title="Product intelligence"
                hint={`${data.productIntelligence.confidence} confidence`}
              />
              <div className="grid gap-4 lg:grid-cols-3">
                {data.productIntelligence.insights.map((insight) => (
                  <article key={insight.id} className="rounded-xl border border-line bg-paper-0 p-4">
                    <p className="text-[11px] uppercase tracking-wide text-brand-600">
                      {insight.kind} · {insight.priority}
                    </p>
                    <h3 className="mt-2 font-medium">{insight.title}</h3>
                    <p className="mt-2 text-sm text-ink-600">{insight.rationale}</p>
                    <p className="mt-3 text-sm text-ink-800">{insight.action}</p>
                  </article>
                ))}
              </div>
            </>
          )}

          {canSeeAccounts(access?.scope) && (
            <p className="mt-8 text-sm text-ink-500">
              {count(data.accounts?.length ?? 0)} named organizations.{' '}
              <Link to="/accounts" className="text-brand-600 hover:underline">
                Open accounts
              </Link>
              {revenue.mrrGrowthMomPct != null && (
                <span> · MoM {signedPercent(revenue.mrrGrowthMomPct)}</span>
              )}
            </p>
          )}

          {summary.customers.orgsTotal === 0 && (
            <EmptyState
              title="No customers yet"
              body="These tiles read live from production. They fill in as organizations sign up."
            />
          )}
        </>
      )}
    </div>
  );
}
