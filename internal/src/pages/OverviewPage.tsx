import { Link } from 'react-router-dom';
import { useOverview } from '../hooks/useOverview';
import { useProductHealth } from '../hooks/useProductHealth';
import { useAuth } from '../context/AuthContext';
import { canManageAccess } from '../lib/access';
import { count, decimal, duration, moneyCompact, pctChange, percent, shortDate, weekLabel } from '../lib/format';
import { Delta, ErrorLine, KpiStrip, LineChart, Loading, PageHeader } from '../components/report';
import type { EvidencePeriod } from '../lib/types';

const evidenceTotal = (e: EvidencePeriod) => e.dailyReportsSent + e.evidenceDownloads + e.shareLinksCreated;

/**
 * One-screen executive summary: the north star with its trend, six headline
 * figures that each link to their detail page, and an as-of stamp. Tables,
 * breakdowns and definitions live on the detail pages.
 */
export function OverviewPage() {
  const { access } = useAuth();
  const overview = useOverview();
  const health = useProductHealth(12);
  const h = health.data;
  const revenue = overview.data?.summary?.revenue;
  const customers = overview.data?.summary?.customers;
  const latest = h?.northStar.latest ?? null;
  const previous = h?.northStar.previous ?? null;
  const asOfValue = h?.generatedAt ?? overview.data?.generatedAt ?? null;
  const pending = canManageAccess(access?.scope) ? (access?.pendingAccessRequests ?? 0) : 0;

  if ((overview.loading && !overview.data) || (health.loading && !h)) return <Loading label="Loading overview" />;

  const ptsChange = (cur: number | null | undefined, pri: number | null | undefined) =>
    cur == null || pri == null ? null : cur - pri;
  const trend = (h?.northStar.weekly ?? [])
    .filter((w) => !w.partial)
    .map((w) => ({ x: w.weekStart, y: w.hoursPerSeat }));

  return (
    <div>
      <PageHeader
        eyebrow="Atmosphere Analytics · Summary"
        title="Overview"
        subtitle="Headline figures. Select any figure for its detail page."
        asOfValue={asOfValue}
      />

      {pending > 0 && (
        <p className="mt-4 border-l-2 border-brand-500 pl-3 text-[13px] text-ink-700">
          {pending === 1
            ? '1 employee is waiting for access to Atmosphere Analytics.'
            : `${pending} employees are waiting for access to Atmosphere Analytics.`}{' '}
          <Link to="/access" className="font-medium text-brand-600 underline-offset-2 hover:underline">
            Review access requests
          </Link>
        </p>
      )}

      {overview.error && <ErrorLine message={overview.error} onRetry={() => void overview.reload()} />}
      {health.error && <ErrorLine message={health.error} onRetry={() => void health.reload()} />}

      <section
        aria-label="North star"
        className="mt-6 grid grid-cols-1 items-center gap-x-10 gap-y-4 border-b border-line-strong pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] [&>*]:min-w-0"
      >
        <div>
          <p className="eyebrow">North star</p>
          <Link
            to="/north-star"
            className="mt-1 block text-[17px] font-semibold text-ink-900 hover:text-brand-600 hover:underline hover:underline-offset-2"
          >
            Hours filmed per paying seat
          </Link>
          <p className="text-[11.5px] text-ink-500">
            {latest ? `hrs / seat, week of ${weekLabel(latest.weekStart)}` : 'hrs / seat, last full week'}
          </p>
          <p className="mt-3 text-[44px] font-semibold leading-none tracking-tight text-ink-900 tabular-nums" data-testid="north-star-value">
            {decimal(latest?.hoursPerSeat ?? null)}
          </p>
          <p className="mt-2 text-[12px] text-ink-500">
            <Delta value={pctChange(latest?.hoursPerSeat, previous?.hoursPerSeat)} /> vs prior week
            {latest && (
              <>
                {' · '}
                {count(latest.payingSeats)} paying seats, {decimal(latest.hoursPaying, 1)} hrs filmed
              </>
            )}
          </p>
        </div>
        <LineChart
          ariaLabel="Hours filmed per paying seat by week"
          height={150}
          format={(v) => decimal(v, 1)}
          xLabel={weekLabel}
          series={[{ label: 'hrs / seat', primary: true, points: trend }]}
        />
      </section>

      <KpiStrip
        items={[
          {
            label: 'MRR',
            unit: `USD, as of ${shortDate(overview.data?.generatedAt ?? null)}`,
            value: moneyCompact(revenue?.mrrCents ?? null),
            delta: <Delta value={revenue?.mrrGrowthMomPct ?? null} />,
            comparison: 'vs prior month',
            to: '/growth',
          },
          {
            label: 'Paying organizations',
            unit: `count, as of ${shortDate(overview.data?.generatedAt ?? null)}`,
            value: count(customers?.orgsPaying ?? null),
            delta: <Delta value={customers?.orgsGrowthMomPct ?? null} />,
            comparison: 'vs prior month',
            to: '/growth',
          },
          {
            label: 'Upload completion',
            unit: '% of settled, last 4 wks',
            value: percent(h?.uploads.current.completionRatePct ?? null),
            delta: (
              <Delta
                value={ptsChange(h?.uploads.current.completionRatePct, h?.uploads.prior.completionRatePct)}
                format="pts"
              />
            ),
            comparison: 'vs prior 4 wks',
            to: '/capture',
          },
          {
            label: 'Time to analysis',
            unit: 'median, last 4 wks',
            value: duration(h?.analysis.current.medianSeconds ?? null),
            delta: (
              <Delta
                value={pctChange(h?.analysis.current.medianSeconds, h?.analysis.prior.medianSeconds)}
                goodWhen="down"
              />
            ),
            comparison: 'vs prior 4 wks',
            to: '/capture',
          },
          {
            label: 'Evidence delivered',
            unit: 'reports, downloads, links; 4 wks',
            value: h ? count(evidenceTotal(h.evidence.current)) : '—',
            delta: <Delta value={h ? pctChange(evidenceTotal(h.evidence.current), evidenceTotal(h.evidence.prior)) : null} />,
            comparison: 'vs prior 4 wks',
            to: '/capture',
          },
          {
            label: 'Ask error rate',
            unit: '% of turns, last 4 wks',
            value: percent(h?.ask.current.errorRatePct ?? null),
            delta: (
              <Delta
                value={ptsChange(h?.ask.current.errorRatePct, h?.ask.prior.errorRatePct)}
                format="pts"
                goodWhen="down"
              />
            ),
            comparison: 'vs prior 4 wks',
            to: '/ai',
          },
        ]}
      />

      <p className="mt-3 text-[11px] text-ink-500">
        North star: complete Monday–Sunday UTC weeks. “—” means no data in the period yet. Definitions and sources are on
        each detail page.
      </p>
    </div>
  );
}
