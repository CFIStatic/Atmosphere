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
import { DownloadButton } from '../components/DownloadButton';

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
        eyebrow="Product"
        title="Uploads, analysis & evidence"
        subtitle="From a crew member pressing upload to evidence a customer can use: does the video arrive, how long until it is analysed, and what is delivered."
        asOfValue={h?.generatedAt ?? null}
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      {h && u && a && e && (
        <>
          <KpiStrip
            download={{ table: 'capture-headline-figures' }}
            items={[
              {
                label: 'Uploads started',
                unit: 'count, last 4 wks',
                value: count(u.current.started),
                raw: u.current.started,
                rawType: 'integer',
                delta: <Delta value={pctChange(u.current.started, u.prior.started)} />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Completion rate',
                unit: '% of settled uploads',
                value: percent(u.current.completionRatePct),
                raw: u.current.completionRatePct,
                rawType: 'percent',
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
                raw: u.current.failed,
                rawType: 'integer',
                delta: <Delta value={pctChange(u.current.failed, u.prior.failed)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Time to analysis',
                unit: 'median to first analysis, last 4 wks',
                value: duration(a.current.medianSeconds),
                raw: a.current.medianSeconds,
                rawUnit: 'seconds',
                delta: <Delta value={pctChange(a.current.medianSeconds, a.prior.medianSeconds)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
                note: a.current.firstTimeUnknown
                  ? `${count(a.current.analysed - a.current.firstTimeUnknown)} timed · ${count(a.current.firstTimeUnknown)} first time unknown`
                  : undefined,
              },
              {
                label: 'Time to analysis',
                unit: '90th percentile to first analysis, last 4 wks',
                value: duration(a.current.p90Seconds),
                raw: a.current.p90Seconds,
                rawUnit: 'seconds',
                delta: <Delta value={pctChange(a.current.p90Seconds, a.prior.p90Seconds)} goodWhen="down" />,
                comparison: 'vs prior 4 wks',
              },
              {
                label: 'Proofs analysed',
                unit: 'first analysed in the last 4 wks',
                value: count(e.current.proofsAnalysed),
                raw: e.current.proofsAnalysed,
                rawType: 'integer',
                delta: <Delta value={pctChange(e.current.proofsAnalysed, e.prior.proofsAnalysed)} />,
                comparison: 'vs prior 4 wks',
              },
            ]}
          />

          <Section
            title="Upload outcomes"
            note={u.trackingSince ? `Tracked since ${shortDate(u.trackingSince)}` : 'Tracking starts with this release'}
            actions={
              <DownloadButton
                table="upload-outcomes"
                label="upload outcomes and failures"
                sheets={() => [
                  {
                    name: 'Upload outcomes',
                    columns: [
                      { header: 'Uploads' },
                      { header: 'Last 4 wks', type: 'integer' },
                      { header: 'Prior 4 wks', type: 'integer' },
                      { header: 'Change', type: 'percent' },
                    ],
                    rows: [
                      ...UPLOAD_ROWS.map((row) => [
                        row.label,
                        u.current[row.key] as number,
                        u.prior[row.key] as number,
                        pctChange(u.current[row.key] as number, u.prior[row.key] as number),
                      ]),
                      [
                        'Completion rate',
                        { value: u.current.completionRatePct, type: 'percent' as const },
                        { value: u.prior.completionRatePct, type: 'percent' as const },
                        null,
                      ],
                      [
                        'Completion rate change, points',
                        null,
                        null,
                        {
                          value:
                            u.current.completionRatePct != null && u.prior.completionRatePct != null
                              ? u.current.completionRatePct - u.prior.completionRatePct
                              : null,
                          type: 'number' as const,
                          format: '0.0',
                        },
                      ],
                    ],
                  },
                  {
                    name: 'Top failures',
                    columns: [
                      { header: 'Failure code' },
                      { header: 'Uploads', type: 'integer' },
                      { header: 'Share of failures', type: 'percent' },
                    ],
                    rows: u.topErrors.map((err) => [
                      err.code,
                      err.count,
                      u.current.failed > 0 ? (err.count / u.current.failed) * 100 : null,
                    ]),
                  },
                ]}
              />
            }
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

          <Section
            title="Time from upload to first analysis, weekly"
            note="Minutes; median and 90th percentile. Re-runs do not count."
            actions={
              <DownloadButton
                table="time-to-analysis"
                label="time to analysis, weekly and summary"
                sheets={() => [
                  {
                    name: 'Weekly time to analysis',
                    columns: [
                      { header: 'Week of (Mon, UTC)', type: 'date' },
                      { header: 'Analysed', type: 'integer' },
                      { header: 'First time unknown', type: 'integer' },
                      { header: 'Median, minutes', type: 'number' },
                      { header: '90th percentile, minutes', type: 'number' },
                    ],
                    rows: a.weekly.map((w) => [
                      w.weekStart,
                      w.analysed,
                      w.firstTimeUnknown ?? 0,
                      w.medianSeconds === null ? null : w.medianSeconds / 60,
                      w.p90Seconds === null ? null : w.p90Seconds / 60,
                    ]),
                  },
                  {
                    name: 'Analysis summary',
                    columns: [
                      { header: 'Analysis' },
                      { header: 'Last 4 wks', type: 'integer' },
                      { header: 'Prior 4 wks', type: 'integer' },
                    ],
                    rows: [
                      ['Videos received', a.current.received, a.prior.received],
                      ['Analysed', a.current.analysed, a.prior.analysed],
                      ['First analysis time unknown (Sep 21 bulk re-run)', a.current.firstTimeUnknown ?? 0, a.prior.firstTimeUnknown ?? 0],
                      ['Analysis failed', a.current.failed, a.prior.failed],
                      ['Waiting for analysis', a.current.pending, a.prior.pending],
                      ['Median time to analysis, seconds', a.current.medianSeconds, a.prior.medianSeconds],
                      ['90th percentile time to analysis, seconds', a.current.p90Seconds, a.prior.p90Seconds],
                    ],
                  },
                ]}
              />
            }
          >
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
                <tr><td>First analysis time unknown</td><td className="num">{count(a.current.firstTimeUnknown ?? 0)}</td><td className="num text-ink-600">{count(a.prior.firstTimeUnknown ?? 0)}</td></tr>
                <tr><td>Analysis failed</td><td className="num">{count(a.current.failed)}</td><td className="num text-ink-600">{count(a.prior.failed)}</td></tr>
                <tr><td>Waiting for analysis</td><td className="num">{count(a.current.pending)}</td><td className="num text-ink-600">{count(a.prior.pending)}</td></tr>
              </tbody>
            </table>
            </div>
          </Section>

          <Section
            title="Evidence delivered"
            note="Last 4 weeks vs prior 4 weeks"
            actions={
              <DownloadButton
                table="evidence-delivered"
                label="evidence delivered"
                sheets={() => [
                  {
                    name: 'Evidence delivered',
                    columns: [
                      { header: 'Output' },
                      { header: 'Last 4 wks', type: 'integer' },
                      { header: 'Prior 4 wks', type: 'integer' },
                      { header: 'Change', type: 'percent' },
                    ],
                    rows: [
                      ['Proofs analysed', e.current.proofsAnalysed, e.prior.proofsAnalysed, pctChange(e.current.proofsAnalysed, e.prior.proofsAnalysed)],
                      ['Daily reports sent', e.current.dailyReportsSent, e.prior.dailyReportsSent, pctChange(e.current.dailyReportsSent, e.prior.dailyReportsSent)],
                      ['Evidence downloads', e.current.evidenceDownloads, e.prior.evidenceDownloads, pctChange(e.current.evidenceDownloads, e.prior.evidenceDownloads)],
                      ['Share links created', e.current.shareLinksCreated, e.prior.shareLinksCreated, pctChange(e.current.shareLinksCreated, e.prior.shareLinksCreated)],
                      ['Share links opened (latest open in window)', e.current.shareLinksOpened, null, null],
                      ['Lifetime share links', e.lifetime.shareLinks, null, null],
                      ['Lifetime share link opens', e.lifetime.shareLinkOpens, null, null],
                    ],
                  },
                ]}
              />
            }
          >
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
          'Analysis: videos received in the window (job_proofs.received_at), deleted jobs and videos excluded. Time is received_at to first_analysed_at, the first time analysis finished; later re-runs (such as the Sep 21 bulk re-analysis) do not reset it. Videos whose first analysis time was overwritten by that re-run are counted as "first time unknown" and left out of the median and p90. Failed = analysis_status failed; waiting = not yet done or failed. Weeks start Monday, UTC.',
          'Evidence: job_proofs (analysed), daily_job_reports (status sent), evidence_downloads, verifier_shares (created_at; last_opened_at for opens). Share-link views keep only a running total, so there is no per-period history.',
        ]}
      />
    </div>
  );
}
