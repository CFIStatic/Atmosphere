import { useEffect, useMemo, useState } from 'react';
import {
  api,
  TOKEN_DISPLAY_FEATURES,
  TOKEN_FEATURE_LABELS,
  type TokenEmployeeBreakdown,
  type TokenFeature,
  type TokenJobBreakdown,
  type TokenUsageRange,
  type TokenUsageReport,
} from '../../lib/api';
import { formatTokens } from '../../lib/money';
import { TokenUsageChart } from './TokenUsageChart';
import {
  TOKEN_FEATURE_TRACK,
  type UsageBucket,
  dailyUsageRows,
  formatAnalysisMinutes,
  mergeAskIntoChat,
  sharePct,
} from './tokenUsageModel';

// Usage over time picks its own window; the rest of the page is the billing period.
const CHART_RANGES: { id: TokenUsageRange; label: string; bucket: UsageBucket }[] = [
  { id: '7d', label: 'Week', bucket: 'day' },
  { id: '30d', label: 'Month', bucket: 'day' },
  { id: '90d', label: 'Quarter', bucket: 'week' },
  { id: '365d', label: 'Annual', bucket: 'month' },
];

const BUCKET_CAPTION: Record<UsageBucket, string> = {
  day: 'Stacked daily tokens',
  week: 'Stacked weekly tokens',
  month: 'Stacked monthly tokens',
};

export function TokenUsageSection() {
  const range: TokenUsageRange = 'period';
  const [report, setReport] = useState<TokenUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getTokenUsage(range)
      .then((next) => {
        if (live) setReport(mergeAskIntoChat(next));
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load token usage.');
      });
    return () => {
      live = false;
    };
  }, []);

  const totals = report?.totals;
  const featureMax = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.byFeature.map((row) => row.totalTokens));
  }, [report]);

  const matchesRange = report?.range === range;
  if (error && !matchesRange) {
    return (
      <p role="alert" className="text-sm text-danger-600">
        {error}
      </p>
    );
  }

  if (!report || !totals || !matchesRange) {
    return <p className="text-sm text-ink-600">Loading token usage…</p>;
  }

  const seats = report.byEmployee.filter((row) => row.userId !== null || row.totalTokens > 0);
  // Homeowners and subs using Chat on a shared job are billed here but are not employees.
  const employees = seats.filter((row) => !row.outsideOrg);
  const guests = seats.filter((row) => row.outsideOrg && row.totalTokens > 0);
  const tokenShare = (count: number) => sharePct(count, totals.totalTokens);
  const daily = dailyUsageRows(report.byDay, report.recent);

  return (
    <div className="space-y-6">
      <UsageOverTime />

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Metering</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          How this billing period’s tokens split by class and by product surface.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Token class
            </h4>
            <ul className="mt-3 space-y-3">
              <Meter
                label="Input"
                value={formatTokens(totals.inputTokens)}
                pct={tokenShare(totals.inputTokens)}
                track="bg-brand-600"
              />
              <Meter
                label="Output"
                value={formatTokens(totals.outputTokens)}
                pct={tokenShare(totals.outputTokens)}
                track="bg-success-600"
              />
              <Meter
                label="Cache"
                value={formatTokens(totals.cacheTokens)}
                pct={tokenShare(totals.cacheTokens)}
                track="bg-ink-400"
              />
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              By application
            </h4>
            <ul className="mt-3 space-y-3">
              {TOKEN_DISPLAY_FEATURES.map((feature) => {
                const row = report.byFeature.find((item) => item.feature === feature);
                // Web search is billed per Tavily credit, not per token: show searches.
                const searches = row?.events ?? 0;
                const amount =
                  feature === 'web_search'
                    ? `${searches.toLocaleString()} search${searches === 1 ? '' : 'es'}`
                    : formatTokens(row?.totalTokens ?? 0);
                return (
                  <Meter
                    key={feature}
                    label={TOKEN_FEATURE_LABELS[feature]}
                    value={amount}
                    pct={
                      feature === 'web_search'
                        ? sharePct(searches, Math.max(totals.events, 1))
                        : sharePct(row?.totalTokens ?? 0, featureMax)
                    }
                    track={TOKEN_FEATURE_TRACK[feature]}
                  />
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">By employee</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Every seat on this organization for the selected period. Unattributed rows are usage we
          could not tie to an uploader, job owner, or signed-in teammate.
        </p>
        {employees.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            No teammates on this organization yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-xl text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Person</th>
                  <th className="px-3 py-2 text-right font-semibold">Video</th>
                  <th className="px-3 py-2 text-right font-semibold">Chat</th>
                  <th className="py-2 pl-3 text-right font-semibold">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <EmployeeRow
                    key={row.userId ?? 'unattributed'}
                    row={row}
                    totalTokens={totals.totalTokens}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {guests.length > 0 ? (
          <div className="mt-5" data-testid="shared-job-guests">
            <h4 className="text-sm font-semibold text-ink-900">People you shared jobs with</h4>
            <p className="mt-0.5 text-xs text-ink-500">
              Homeowners and subcontractors outside this organization who used AI on a job you
              shared. They are not employees, but their usage is on this organization&apos;s bill.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-xl text-left text-xs">
                <tbody>
                  {guests.map((row) => (
                    <EmployeeRow
                      key={row.userId ?? 'guest'}
                      row={row}
                      totalTokens={totals.totalTokens}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Usage by job</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Analysis minutes are the length of film that finished AI analysis (proof duration), not a
          tokens-to-minutes estimate.
        </p>
        {(report.byJob ?? []).length === 0 ? (
          <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            No job-attributed AI usage in this window yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-160 text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Job</th>
                  <th className="px-3 py-2 text-right font-semibold">Analysis min</th>
                  <th className="px-3 py-2 text-right font-semibold">Video</th>
                  <th className="px-3 py-2 text-right font-semibold">Chat</th>
                  <th className="py-2 pl-3 text-right font-semibold">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {(report.byJob ?? []).map((row) => (
                  <JobUsageRow key={row.jobId} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl glass-card p-5" data-testid="daily-usage">
        <h3 className="text-base font-semibold text-ink-900">Daily usage</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          One row per day in this billing period, newest first.
        </p>
        {daily.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            Nothing metered yet.
          </p>
        ) : (
          <div className="mt-3 max-h-128 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="sticky top-0 z-10 bg-paper-0/95 py-2 pr-3 font-semibold backdrop-blur-xs">
                    Day
                  </th>
                  <th className="sticky top-0 z-10 bg-paper-0/95 px-3 py-2 text-right font-semibold backdrop-blur-xs">
                    Calls
                  </th>
                  <th className="sticky top-0 z-10 bg-paper-0/95 py-2 pl-3 text-right font-semibold backdrop-blur-xs">
                    Tokens
                  </th>
                </tr>
              </thead>
              <tbody>
                {daily.map((row) => (
                  <tr key={row.day} className="border-b border-line/60 align-top last:border-b-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium tabular-nums text-ink-900">{row.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-ink-500">
                        {row.breakdown}
                      </div>
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-800"
                      data-testid={`daily-calls-${row.day}`}
                    >
                      {row.calls.toLocaleString('en-US')}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums font-medium text-ink-900">
                      {formatTokens(row.totalTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function UsageOverTime() {
  const [range, setRange] = useState<TokenUsageRange>('30d');
  const [report, setReport] = useState<TokenUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getTokenUsage(range)
      .then((next) => {
        if (live) {
          setReport(mergeAskIntoChat(next));
          setError(null);
        }
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load token usage.');
      });
    return () => {
      live = false;
    };
  }, [range]);

  const option = CHART_RANGES.find((item) => item.id === range) ?? CHART_RANGES[1]!;
  const ready = report?.range === range;

  return (
    <section className="rounded-xl glass-card p-5" data-testid="usage-over-time">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Usage over time</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {BUCKET_CAPTION[option.bucket]} — video analysis, chat, and computer.
          </p>
        </div>
        <div
          className="flex rounded-lg border border-line bg-paper-50 p-0.5"
          role="tablist"
          aria-label="Usage over time window"
        >
          {CHART_RANGES.map((item) => {
            const active = range === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRange(item.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                  active ? 'bg-paper-0 text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4">
        {ready ? (
          <TokenUsageChart days={report.byDay} bucket={option.bucket} />
        ) : error ? (
          <p role="alert" className="text-sm text-danger-600">
            {error}
          </p>
        ) : (
          <p className="py-8 text-center text-sm text-ink-600">Loading usage…</p>
        )}
      </div>
    </section>
  );
}

function Meter({
  label,
  value,
  pct,
  track,
}: {
  label: string;
  value: string;
  pct: number;
  track: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-ink-800">{label}</span>
        <span className="tabular-nums text-ink-600">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-200" aria-hidden>
        <div
          className={`h-full rounded-full ${track}`}
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
    </li>
  );
}

function JobUsageRow({ row }: { row: TokenJobBreakdown }) {
  const minutes = formatAnalysisMinutes(row.analysisMinutes);
  const feature = (key: TokenFeature) => formatTokens(row.byFeature?.[key]?.totalTokens ?? 0);
  const label = row.title;
  return (
    <tr className="border-b border-line/60 last:border-b-0">
      <td className="py-2.5 pr-3">
        <div className="font-medium text-ink-900">{label}</div>
        <div className="text-[11px] text-ink-500">
          {row.analysisMinutes != null
            ? `This job used ${minutes} analysis minute${row.analysisMinutes === 1 ? '' : 's'}`
            : 'Analysis minutes unknown (no timed analysed film)'}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-ink-900">{minutes}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">
        {feature('video_analysis')}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{feature('chat')}</td>
      <td className="py-2.5 pl-3 text-right tabular-nums font-medium text-ink-900">
        {formatTokens(row.totalTokens)}
      </td>
    </tr>
  );
}

function EmployeeRow({ row, totalTokens }: { row: TokenEmployeeBreakdown; totalTokens: number }) {
  const feature = (key: TokenFeature) => formatTokens(row.byFeature?.[key]?.totalTokens ?? 0);
  return (
    <tr className="border-b border-line/60 last:border-b-0">
      <td className="py-2.5 pr-3">
        <div className="font-medium text-ink-900">{row.name}</div>
        <div className="text-[11px] text-ink-500">
          {row.roleLabel}
          {row.email ? ` · ${row.email}` : ''}
          {totalTokens > 0 ? ` · ${sharePct(row.totalTokens, totalTokens).toFixed(0)}% of org` : ''}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">
        {feature('video_analysis')}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{feature('chat')}</td>
      <td className="py-2.5 pl-3 text-right tabular-nums font-medium text-ink-900">
        {formatTokens(row.totalTokens)}
      </td>
    </tr>
  );
}
