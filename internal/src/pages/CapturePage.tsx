import { useProductHealth } from '../hooks/useProductHealth';
import { count, duration, pctChange, percent, shortDate, weekLabel } from '../lib/format';
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
import type { UploadPeriod } from '../lib/types';

const UPLOAD_ROWS: Array<{ key: keyof UploadPeriod; label: string; goodWhen: 'up' | 'down' }> = [
  { key: 'started', label: 'Started', goodWhen: 'up' },
  { key: 'completed', label: 'Completed', goodWhen: 'up' },
  { key: 'failed', label: 'Failed', goodWhen: 'down' },
  { key: 'abandoned', label: 'Abandoned', goodWhen: 'down' },
  { key: 'inFlight', label: 'In flight', goodWhen: 'up' },
  { key: 'retried', label: 'Needed a retry', goodWhen: 'down' },
];

export function CapturePage() {
  const { data: h, error, loading, reload } = useProductHealth(12);

  if (loading && !h) return <Loading label="Loading capture pipeline" />;

  const u = h?.uploads;
  const a = h?.analysis;
  const e = h?.evidence;

  return (
    <div>
      <PageHeader
        eyebrow="Capture pipeline"
        title="Uploads, analysis & evidence"
        subtitle="From a crew member pressing upload to evidence a customer can use: does the video arrive, how long until it is analysed, and what is delivered."
        asOfValue={h?.generatedAt ?? null}
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      {h && u && a && e && (
        <>
          <KpiStrip
            items={[
              {
                label: 'Uploads started',
                unit: 'count, last 4 wks',
                value: count(u.current.started),
                delta: <Delta value={pctChange(u.current.started, u.prior.started)} />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Completion rate',
                unit: '% of settled uploads',
                value: percent(u.current.completionRatePct),
                delta: (
                  <Delta
                    value={
                      u.current.completionRatePct != null && u.prior.completionRatePct != null
                        ? u.current.completionRatePct - u.prior.completionRatePct
                        : null
                    }
                    format="pts"
                  />
                ),
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Failed',
                unit: 'count, last 4 wks',
                value: count(u.current.failed),
                delta: <Delta value={pctChange(u.current.failed, u.prior.failed)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Time to analysis',
                unit: 'median, last 4 wks',
                value: duration(a.current.medianSeconds),
                delta: <Delta value={pctChange(a.current.medianSeconds, a.prior.medianSeconds)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Time to analysis',
                unit: '90th percentile, last 4 wks',
                value: duration(a.current.p90Seconds),
                delta: <Delta value={pctChange(a.current.p90Seconds, a.prior.p90Seconds)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Proofs analysed',
                unit: 'count, last 4 wks',
                value: count(e.current.proofsAnalysed),
                delta: <Delta value={pctChange(e.current.proofsAnalysed, e.prior.proofsAnalysed)} />,
                comparison: 'vs prior 4 wks',
              },
            ]}
          />

          <Section
            title="Upload outcomes"
            note={u.trackingSince ? `Tracked since ${shortDate(u.trackingSince)}` : 'Tracking starts with this release'}
          >
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 [&>*]:min-w-0">
              <div className="overflow-x-auto">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Uploads<Fn n={1} /></th>
                    <th className="num">Last 4 wks</th>
                    <th className="num">Prior 4 wks</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {UPLOAD_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="num">{count(u.current[row.key] as number)}</td>
                      <td className="num text-ink-600">{count(u.prior[row.key] as number)}</td>
                      <td className="num">
                        <Delta
                          value={pctChange(u.current[row.key] as number, u.prior[row.key] as number)}
                          goodWhen={row.goodWhen}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold text-ink-900">Completion rate</td>
                    <td className="num font-semibold text-ink-900">{percent(u.current.completionRatePct)}</td>
                    <td className="num text-ink-600">{percent(u.prior.completionRatePct)}</td>
                    <td className="num">
                      <Delta
                        value={
                          u.current.completionRatePct != null && u.prior.completionRatePct != null
                            ? u.current.completionRatePct - u.prior.completionRatePct
                            : null
                        }
                        format="pts"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
              <div className="overflow-x-auto">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Most common failure, last 4 wks<Fn n={2} /></th>
                    <th className="num">Uploads</th>
                    <th className="num">Share of failures</th>
                  </tr>
                </thead>
                <tbody>
                  {u.topErrors.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-ink-500">No failed uploads in the window.</td>
                    </tr>
                  ) : (
                    u.topErrors.map((err) => (
                      <tr key={err.code}>
                        <td className="font-mono text-[12px]">{err.code}</td>
                        <td className="num">{count(err.count)}</td>
                        <td className="num">
                          {percent(u.current.failed > 0 ? (err.count / u.current.failed) * 100 : null)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </Section>

          <Section title="Time from upload to analysis, weekly" note="Minutes; median and 90th percentile">
            <LineChart
              ariaLabel="Median and 90th percentile minutes from upload to analysis by week"
              format={(v) => `${v.toFixed(0)} min`}
              xLabel={weekLabel}
              series={[
                {
                  label: 'median',
                  primary: true,
                  points: a.weekly.map((w) => ({ x: w.weekStart, y: w.medianSeconds === null ? null : w.medianSeconds / 60 })),
                },
                {
                  label: 'p90',
                  points: a.weekly.map((w) => ({ x: w.weekStart, y: w.p90Seconds === null ? null : w.p90Seconds / 60 })),
                },
              ]}
            />
            <div className="overflow-x-auto mt-4 max-w-2xl">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Analysis<Fn n={3} /></th>
                  <th className="num">Last 4 wks</th>
                  <th className="num">Prior 4 wks</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Videos received</td><td className="num">{count(a.current.received)}</td><td className="num text-ink-600">{count(a.prior.received)}</td></tr>
                <tr><td>Analysed</td><td className="num">{count(a.current.analysed)}</td><td className="num text-ink-600">{count(a.prior.analysed)}</td></tr>
                <tr><td>Analysis failed</td><td className="num">{count(a.current.failed)}</td><td className="num text-ink-600">{count(a.prior.failed)}</td></tr>
                <tr><td>Waiting for analysis</td><td className="num">{count(a.current.pending)}</td><td className="num text-ink-600">{count(a.prior.pending)}</td></tr>
              </tbody>
            </table>
            </div>
          </Section>

          <Section title="Evidence delivered" note="Last 4 weeks vs prior 4 weeks">
            <div className="overflow-x-auto max-w-3xl">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Output<Fn n={4} /></th>
                  <th className="num">Last 4 wks</th>
                  <th className="num">Prior 4 wks</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Proofs analysed</td>
                  <td className="num">{count(e.current.proofsAnalysed)}</td>
                  <td className="num text-ink-600">{count(e.prior.proofsAnalysed)}</td>
                  <td className="num"><Delta value={pctChange(e.current.proofsAnalysed, e.prior.proofsAnalysed)} /></td>
                </tr>
                <tr>
                  <td>Daily reports sent</td>
                  <td className="num">{count(e.current.dailyReportsSent)}</td>
                  <td className="num text-ink-600">{count(e.prior.dailyReportsSent)}</td>
                  <td className="num"><Delta value={pctChange(e.current.dailyReportsSent, e.prior.dailyReportsSent)} /></td>
                </tr>
                <tr>
                  <td>Evidence downloads</td>
                  <td className="num">{count(e.current.evidenceDownloads)}</td>
                  <td className="num text-ink-600">{count(e.prior.evidenceDownloads)}</td>
                  <td className="num"><Delta value={pctChange(e.current.evidenceDownloads, e.prior.evidenceDownloads)} /></td>
                </tr>
                <tr>
                  <td>Share links created</td>
                  <td className="num">{count(e.current.shareLinksCreated)}</td>
                  <td className="num text-ink-600">{count(e.prior.shareLinksCreated)}</td>
                  <td className="num"><Delta value={pctChange(e.current.shareLinksCreated, e.prior.shareLinksCreated)} /></td>
                </tr>
                <tr>
                  <td>Share links opened (latest open in window)</td>
                  <td className="num">{count(e.current.shareLinksOpened)}</td>
                  <td className="num" colSpan={2}>
                    <span className="text-[12px] italic text-ink-500">n/a: only each link’s latest open is kept</span>
                  </td>
                </tr>
                <tr>
                  <td className="text-ink-600">Lifetime share links / opens</td>
                  <td className="num text-ink-600" colSpan={3}>
                    {count(e.lifetime.shareLinks)} / {count(e.lifetime.shareLinkOpens)}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </Section>
        </>
      )}

      <Footnotes
        asOfValue={h?.generatedAt ?? null}
        notes={[
          'Uploads: capture_upload_attempts, one row per upload from the first signed upload URL. Completion rate = completed ÷ (started − in flight). In flight = activity within 24 hours and not finished; abandoned = neither finished nor active within 24 hours. Uploads before this release are not in the history.',
          'Failure codes are the upload_* error codes the API returned when stitching or recording the upload.',
          'Analysis: videos received in the window (job_proofs.received_at). Time is received_at to analysed_at for those whose analysis finished; failed = analysis_status failed; waiting = not yet done or failed.',
          'Evidence: job_proofs (analysed), daily_job_reports (status sent), evidence_downloads, verifier_shares (created_at; last_opened_at for opens). Share-link views keep only a running total, so there is no per-period history.',
        ]}
      />
    </div>
  );
}
