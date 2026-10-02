import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useOverview } from '../hooks/useOverview';
import { useProductHealth } from '../hooks/useProductHealth';
import { useAuth } from '../context/AuthContext';
import { canManageAccess, canSeeAccounts } from '../lib/access';
import {
  count,
  decimal,
  duration,
  moneyCompact,
  msAsSeconds,
  pctChange,
  percent,
  shortDate,
  weekLabel,
} from '../lib/format';
import {
  Delta,
  ErrorLine,
  Fn,
  Footnotes,
  KpiStrip,
  LineChart,
  Loading,
  NotTracked,
  PageHeader,
  Section,
} from '../components/report';
import type { ProductHealth } from '../lib/types';

interface SignalRow {
  label: string;
  unit: string;
  current: string;
  prior: string;
  change: ReactNode;
  source: number;
}

function signals(h: ProductHealth): SignalRow[] {
  const u = h.uploads;
  const a = h.analysis;
  const e = h.evidence;
  const k = h.ask;
  const pts = (cur: number | null, pri: number | null) => (cur === null || pri === null ? null : cur - pri);
  return [
    {
      label: 'Uploads started',
      unit: 'count',
      current: count(u.current.started),
      prior: count(u.prior.started),
      change: <Delta value={pctChange(u.current.started, u.prior.started)} />,
      source: 2,
    },
    {
      label: 'Upload completion rate',
      unit: '% of settled',
      current: percent(u.current.completionRatePct),
      prior: percent(u.prior.completionRatePct),
      change: <Delta value={pts(u.current.completionRatePct, u.prior.completionRatePct)} format="pts" />,
      source: 2,
    },
    {
      label: 'Uploads failed or abandoned',
      unit: 'count',
      current: count(u.current.failed + u.current.abandoned),
      prior: count(u.prior.failed + u.prior.abandoned),
      change: (
        <Delta
          value={pctChange(u.current.failed + u.current.abandoned, u.prior.failed + u.prior.abandoned)}
          goodWhen="down"
        />
      ),
      source: 2,
    },
    {
      label: 'Time to analysis, median',
      unit: 'upload → analysed',
      current: duration(a.current.medianSeconds),
      prior: duration(a.prior.medianSeconds),
      change: <Delta value={pctChange(a.current.medianSeconds, a.prior.medianSeconds)} goodWhen="down" />,
      source: 3,
    },
    {
      label: 'Time to analysis, 90th pct.',
      unit: 'upload → analysed',
      current: duration(a.current.p90Seconds),
      prior: duration(a.prior.p90Seconds),
      change: <Delta value={pctChange(a.current.p90Seconds, a.prior.p90Seconds)} goodWhen="down" />,
      source: 3,
    },
    {
      label: 'Proofs analysed',
      unit: 'count',
      current: count(e.current.proofsAnalysed),
      prior: count(e.prior.proofsAnalysed),
      change: <Delta value={pctChange(e.current.proofsAnalysed, e.prior.proofsAnalysed)} />,
      source: 4,
    },
    {
      label: 'Evidence delivered',
      unit: 'reports + downloads + share links',
      current: count(e.current.dailyReportsSent + e.current.evidenceDownloads + e.current.shareLinksCreated),
      prior: count(e.prior.dailyReportsSent + e.prior.evidenceDownloads + e.prior.shareLinksCreated),
      change: (
        <Delta
          value={pctChange(
            e.current.dailyReportsSent + e.current.evidenceDownloads + e.current.shareLinksCreated,
            e.prior.dailyReportsSent + e.prior.evidenceDownloads + e.prior.shareLinksCreated,
          )}
        />
      ),
      source: 4,
    },
    {
      label: 'Ask questions',
      unit: 'count',
      current: count(k.questions.current),
      prior: count(k.questions.prior),
      change: <Delta value={pctChange(k.questions.current, k.questions.prior)} />,
      source: 5,
    },
    {
      label: 'Ask latency, median',
      unit: 'full answer',
      current: msAsSeconds(k.current.medianMs),
      prior: msAsSeconds(k.prior.medianMs),
      change: <Delta value={pctChange(k.current.medianMs, k.prior.medianMs)} goodWhen="down" />,
      source: 5,
    },
    {
      label: 'Ask error rate',
      unit: '% of turns',
      current: percent(k.current.errorRatePct),
      prior: percent(k.prior.errorRatePct),
      change: <Delta value={pts(k.current.errorRatePct, k.prior.errorRatePct)} format="pts" goodWhen="down" />,
      source: 5,
    },
  ];
}

const DRILL_DOWNS = [
  { to: '/growth', title: 'Revenue & customers', body: 'MRR, ARR, paying organizations, plan mix and unit economics.' },
  { to: '/capture', title: 'Capture pipeline', body: 'Upload completion and failures, time to analysis, evidence delivered.' },
  { to: '/ai', title: 'AI & Ask', body: 'Questions asked, latency, error and refusal rates.' },
  { to: '/usage', title: 'Feature usage', body: 'Hours and sessions by product surface.' },
  { to: '/accounts', title: 'Organizations', body: 'Per-account revenue, seats and activity.', internal: true },
  { to: '/contacts', title: 'Contacts & campaigns', body: 'Customer contacts from Stripe and draft email campaigns.', internal: true },
];

export function OverviewPage() {
  const { access } = useAuth();
  const overview = useOverview();
  const health = useProductHealth(12);
  const h = health.data;
  const revenue = overview.data?.summary?.revenue;
  const customers = overview.data?.summary?.customers;
  const latest = h?.northStar.latest ?? null;
  const previous = h?.northStar.previous ?? null;
  const internal = canSeeAccounts(access?.scope);
  const asOfValue = h?.generatedAt ?? overview.data?.generatedAt ?? null;

  if ((overview.loading && !overview.data) || (health.loading && !h)) return <Loading label="Loading overview" />;

  return (
    <div>
      <PageHeader
        eyebrow="Atmosphere Analytics · Summary"
        title="Overview"
        subtitle="Hours of work filmed per paying seat is the north star: it rises only when paying customers capture real jobs. Everything else on this page explains its movement."
        asOfValue={asOfValue}
      />

      {canManageAccess(access?.scope) && (access?.pendingAccessRequests ?? 0) > 0 && (
        <p className="mt-4 border-l-2 border-brand-500 pl-3 text-[13px] text-ink-700">
          {access?.pendingAccessRequests === 1
            ? '1 employee is waiting for access to Atmosphere Analytics.'
            : `${access?.pendingAccessRequests} employees are waiting for access to Atmosphere Analytics.`}{' '}
          <Link to="/access" className="font-medium text-brand-600 underline-offset-2 hover:underline">
            Review access requests
          </Link>
        </p>
      )}

      {overview.error && <ErrorLine message={overview.error} onRetry={() => void overview.reload()} />}
      {health.error && <ErrorLine message={health.error} onRetry={() => void health.reload()} />}

      <KpiStrip
        items={[
          {
            label: 'Hours filmed per paying seat',
            unit: latest ? `hrs / seat, wk of ${weekLabel(latest.weekStart)}` : 'hrs / seat, last full week',
            value: decimal(latest?.hoursPerSeat ?? null),
            delta: <Delta value={pctChange(latest?.hoursPerSeat, previous?.hoursPerSeat)} />,
            comparison: 'vs prior wk',
          },
          {
            label: 'MRR',
            unit: `USD, as of ${shortDate(overview.data?.generatedAt ?? null)}`,
            value: moneyCompact(revenue?.mrrCents ?? null),
            delta: <Delta value={revenue?.mrrGrowthMomPct ?? null} />,
            comparison: 'vs prior month',
          },
          {
            label: 'Paying organizations',
            unit: `count, as of ${shortDate(overview.data?.generatedAt ?? null)}`,
            value: count(customers?.orgsPaying ?? null),
            delta: <Delta value={customers?.orgsGrowthMomPct ?? null} />,
            comparison: 'vs prior month',
          },
          {
            label: 'Upload completion',
            unit: '% of settled, last 4 wks',
            value: percent(h?.uploads.current.completionRatePct ?? null),
            delta: (
              <Delta
                value={
                  h?.uploads.current.completionRatePct != null && h.uploads.prior.completionRatePct != null
                    ? h.uploads.current.completionRatePct - h.uploads.prior.completionRatePct
                    : null
                }
                format="pts"
              />
            ),
            comparison: 'vs prior 4 wks',
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
          },
          {
            label: 'Ask error rate',
            unit: '% of turns, last 4 wks',
            value: percent(h?.ask.current.errorRatePct ?? null),
            delta: (
              <Delta
                value={
                  h?.ask.current.errorRatePct != null && h.ask.prior.errorRatePct != null
                    ? h.ask.current.errorRatePct - h.ask.prior.errorRatePct
                    : null
                }
                format="pts"
                goodWhen="down"
              />
            ),
            comparison: 'vs prior 4 wks',
          },
        ]}
      />

      {h && (
        <Section
          title="North star: hours filmed per paying seat, weekly"
          note={`Complete weeks, Monday–Sunday UTC; the week in progress is shown in the table only`}
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
            <LineChart
              ariaLabel="Hours filmed per paying seat by week"
              format={(v) => decimal(v, 1)}
              xLabel={weekLabel}
              series={[
                {
                  label: 'hrs / seat',
                  primary: true,
                  points: h.northStar.weekly
                    .filter((w) => !w.partial)
                    .map((w) => ({ x: w.weekStart, y: w.hoursPerSeat })),
                },
              ]}
            />
            <div className="overflow-x-auto">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th className="num">Paying seats</th>
                  <th className="num">Hours, paying</th>
                  <th className="num">Hrs / seat</th>
                </tr>
              </thead>
              <tbody>
                {h.northStar.weekly
                  .slice(-6)
                  .reverse()
                  .map((w) => (
                    <tr key={w.weekStart}>
                      <td className="whitespace-nowrap">
                        {weekLabel(w.weekStart)}
                        {w.partial && <span className="ml-1.5 text-[11px] text-ink-500">to date</span>}
                      </td>
                      <td className="num">{count(w.payingSeats)}</td>
                      <td className="num">{decimal(w.hoursPaying, 1)}</td>
                      <td className="num font-semibold text-ink-900">{decimal(w.hoursPerSeat)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            </div>
          </div>
        </Section>
      )}

      {h && (
        <Section title="Health signals" note="Last 4 weeks vs prior 4 weeks">
          <div className="overflow-x-auto">
            <table className="report-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Measure</th>
                  <th className="num">Last 4 wks</th>
                  <th className="num">Prior 4 wks</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {signals(h).map((row) => (
                  <tr key={row.label}>
                    <td className="font-medium text-ink-900">
                      {row.label}
                      <Fn n={row.source} />
                    </td>
                    <td className="text-ink-500">{row.unit}</td>
                    <td className="num">{row.current}</td>
                    <td className="num text-ink-600">{row.prior}</td>
                    <td className="num">{row.change}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium text-ink-900">
                    Ask answer feedback
                    <Fn n={5} />
                  </td>
                  <td className="text-ink-500">% helpful</td>
                  <td className="num" colSpan={3}>
                    <NotTracked>No rating control exists in the product</NotTracked>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Drill-downs">
        <ul className="grid gap-x-10 sm:grid-cols-2">
          {DRILL_DOWNS.filter((d) => !d.internal || internal).map((d) => (
            <li key={d.to} className="border-b border-line py-2.5">
              <Link to={d.to} className="group block">
                <span className="text-[13.5px] font-medium text-ink-900 group-hover:text-brand-600">{d.title}</span>
                <span className="block text-[12px] text-ink-500">{d.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Footnotes
        asOfValue={asOfValue}
        notes={[
          <>
            Hours filmed per paying seat: total duration of capture videos received in the week from organizations whose
            latest billing event is active or past due with MRR above zero, divided by those organizations’ billed seats.
            Sources: job_proofs.duration_seconds, org_billing_events. Trial and free usage is excluded.
          </>,
          <>
            Uploads: one record per upload from the first upload URL to completion or failure (capture_upload_attempts).
            Completion rate = completed ÷ (started − still in flight). Abandoned = no activity for 24 hours.
            {h?.uploads.trackingSince ? ` Tracking since ${shortDate(h.uploads.trackingSince)}.` : ' History starts when this release deploys.'}
          </>,
          <>Time to analysis: job_proofs.received_at to analysed_at, for videos received in the window whose analysis finished.</>,
          <>
            Evidence: proofs analysed (job_proofs), daily reports sent (daily_job_reports), evidence downloads
            (evidence_downloads) and share links created (verifier_shares). Share-link opens keep only a lifetime counter,
            so there is no prior-period comparison.
          </>,
          <>
            Ask: questions from job_proof_questions; latency, outcome and errors from ask_turn_events, recorded for job and
            progress-share Ask. Answer feedback is not collected in the product today.
          </>,
          <>MRR and paying organizations: org_billing_events via the existing analytics_summary report. Month-over-month change.</>,
        ]}
      />
    </div>
  );
}
