import { useEffect, useMemo, useState } from 'react';
import {
  api,
  TOKEN_FEATURE_LABELS,
  TOKEN_FEATURES,
  type TokenEmployeeBreakdown,
  type TokenFeature,
  type TokenUsageRange,
  type TokenUsageReport,
} from '../../lib/api';
import { formatTokens, formatUsd, formatUsdCompact } from '../../lib/money';
import { TokenUsageChart } from './TokenUsageChart';
import { TOKEN_FEATURE_TRACK, sharePct } from './tokenUsageModel';

const RANGES: { id: TokenUsageRange; label: string }[] = [
  { id: 'period', label: 'This period' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
];

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

export function TokenUsageSection() {
  const [range, setRange] = useState<TokenUsageRange>('period');
  const [report, setReport] = useState<TokenUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .getTokenUsage(range)
      .then((next) => {
        if (live) setReport(next);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load token usage.');
      });
    return () => {
      live = false;
    };
  }, [range]);

  const totals = report?.totals;
  const featureMax = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.byFeature.map((row) => row.totalTokens));
  }, [report]);

  if (error && !report) {
    return (
      <p role="alert" className="text-sm text-danger-600">
        {error}
      </p>
    );
  }

  if (!report || !totals) {
    return <p className="text-sm text-ink-600">Loading token usage…</p>;
  }

  const employees = report.byEmployee.filter((row) => row.userId !== null || row.totalTokens > 0);
  const tokenShare = (count: number) => sharePct(count, totals.totalTokens);

  return (
    <div className="space-y-6">
      <section className="rounded-xl glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink-900">Token usage</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Tokens spent analysing videos, chatting with the assistant, and asking the record.
              {report.periodStart ? ` ${day(report.periodStart)} — ${day(report.periodEnd)}.` : null}
            </p>
          </div>
          <div className="flex rounded-lg border border-line bg-paper-50 p-0.5" role="tablist" aria-label="Usage window">
            {RANGES.map((option) => {
              const active = range === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setRange(option.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    active ? 'bg-paper-0 text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Tokens used" value={formatTokens(totals.totalTokens)} hint={`${totals.events.toLocaleString()} metered calls`} />
          <Kpi label="Token spend" value={formatUsd(totals.priceNanos, { precise: true })} hint="Priced from the model rate card" />
          <Kpi
            label="Input / output"
            value={`${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`}
            hint={totals.cacheTokens ? `${formatTokens(totals.cacheTokens)} cached` : 'No cache hits'}
          />
          <Kpi
            label="People using tokens"
            value={String(employees.filter((row) => row.totalTokens > 0 && row.userId).length)}
            hint="Attributed to a signed-in teammate"
          />
        </dl>
      </section>

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Usage over time</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Stacked daily tokens — video analysis, chat, and Ask.
        </p>
        <div className="mt-4">
          <TokenUsageChart days={report.byDay} />
        </div>
      </section>

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Metering</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          How this window’s tokens split by class and by product surface.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Token class</h4>
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
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">By application</h4>
            <ul className="mt-3 space-y-3">
              {TOKEN_FEATURES.map((feature) => {
                const row = report.byFeature.find((item) => item.feature === feature);
                return (
                  <Meter
                    key={feature}
                    label={TOKEN_FEATURE_LABELS[feature]}
                    value={`${formatTokens(row?.totalTokens ?? 0)} · ${formatUsdCompact(row?.priceNanos ?? 0)}`}
                    pct={sharePct(row?.totalTokens ?? 0, featureMax)}
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
          Every seat on this organization. Unattributed rows are usage we could not tie to an uploader, job owner, or signed-in teammate.
        </p>
        {employees.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            No teammates on this organization yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Person</th>
                  <th className="px-3 py-2 text-right font-semibold">Video</th>
                  <th className="px-3 py-2 text-right font-semibold">Chat</th>
                  <th className="px-3 py-2 text-right font-semibold">Ask</th>
                  <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                  <th className="py-2 pl-3 text-right font-semibold">Spend</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <EmployeeRow key={row.userId ?? 'unattributed'} row={row} totalTokens={totals.totalTokens} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Recent calls</h3>
        <p className="mt-0.5 text-xs text-ink-500">Newest metered model calls in this window.</p>
        {report.recent.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            Nothing metered yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Who</th>
                  <th className="px-3 py-2 font-semibold">Surface</th>
                  <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                  <th className="py-2 pl-3 text-right font-semibold">Spend</th>
                </tr>
              </thead>
              <tbody>
                {report.recent.map((row) => (
                  <tr key={row.id} className="border-b border-line/60 last:border-b-0">
                    <td className="py-2.5 pr-3 tabular-nums text-ink-700">{day(row.createdAt)}</td>
                    <td className="px-3 py-2.5 text-ink-700">{row.userName}</td>
                    <td className="px-3 py-2.5 text-ink-700">
                      {TOKEN_FEATURE_LABELS[row.feature]}
                      {row.modelId ? (
                        <span className="block font-mono text-[10.5px] text-ink-500">{row.modelId}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-800">
                      {formatTokens(row.totalTokens)}
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums font-medium text-ink-900">
                      {formatUsd(row.priceNanos, { precise: true })}
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

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-50/80 px-3.5 py-3">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
      <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p>
    </div>
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
        <div className={`h-full rounded-full ${track}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
      </div>
    </li>
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
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{feature('video_analysis')}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{feature('chat')}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{feature('ask')}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-ink-900">
        {formatTokens(row.totalTokens)}
      </td>
      <td className="py-2.5 pl-3 text-right tabular-nums font-medium text-ink-900">
        {formatUsd(row.priceNanos, { precise: true })}
      </td>
    </tr>
  );
}
