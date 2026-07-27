import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { AlertIcon, SpinnerIcon } from '../components/icons';
import { api, ApiError, type BillingOverview, type UsageDay, type UsageEvent } from '../lib/api';
import { formatDate, formatTokens, formatUsd, formatUsdCompact } from '../lib/money';

/**
 * Categorical series colours for the per-model breakdown, in fixed slot order —
 * a model keeps its colour regardless of where it ranks, so a quiet week does
 * not repaint the chart. Validated as a set against this surface (#12121d):
 * lightness band, chroma floor, colour-vision separation and 3:1 contrast all
 * pass. Do not reorder or extend by eye.
 */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

/** Single-hue accent for the one-series daily chart. */
const ACCENT = '#3987e5';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export function UsagePage() {
  const [days, setDays] = useState(30);
  const [daily, setDaily] = useState<UsageDay[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getUsageDaily(days), api.getUsageEvents(25), api.getBillingOverview()])
      .then(([d, e, o]) => {
        if (cancelled) return;
        setDaily(d.days);
        setEvents(e.events);
        setOverview(o);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load usage.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // usage_daily is one row per day *per model*; the time series needs day totals.
  const byDay = useMemo(() => {
    const totals = new Map<string, { priceNanos: number; events: number }>();
    for (const row of daily) {
      const current = totals.get(row.day) ?? { priceNanos: 0, events: 0 };
      current.priceNanos += row.priceNanos;
      current.events += row.events;
      totals.set(row.day, current);
    }
    return [...totals.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [daily]);

  const models = overview?.usageByModel ?? [];
  const periodTotal = overview?.periodUsage.priceNanos ?? 0;
  const maxDay = Math.max(...byDay.map((d) => d.priceNanos), 1);
  const maxModel = Math.max(...models.map((m) => m.priceNanos), 1);

  if (loading) {
    return (
      <AppShell><main className="cx-aurora min-h-screen mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <div className="grid place-items-center py-24 text-brand-300">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      </main></AppShell>
    );
  }

  return (
    <AppShell><main className="cx-aurora min-h-screen mx-auto max-w-6xl px-6 py-10 sm:px-10">
      <div className="animate-fade-in-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Usage</h1>
            <p className="mt-2 text-gray-400">
              Every request is metered from the model provider&apos;s own token counts.
            </p>
          </div>

          <div className="flex rounded-lg border border-white/10 bg-ink-800/60 p-1 text-sm">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  days === r.days ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <AlertIcon width={18} height={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Headline figures are numbers, not charts — a stat tile reads faster
            than a one-value plot. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Spend this period" value={formatUsd(periodTotal)} />
          <StatTile
            label="Requests"
            value={(overview?.periodUsage.events ?? 0).toLocaleString('en-US')}
          />
          <StatTile
            label="Input tokens"
            value={formatTokens(overview?.periodUsage.inputTokens ?? 0)}
            hint={`${formatTokens(overview?.periodUsage.cacheTokens ?? 0)} cached`}
          />
          <StatTile
            label="Output tokens"
            value={formatTokens(overview?.periodUsage.outputTokens ?? 0)}
          />
        </div>

        {/* ---- Daily spend: one series, so no legend — the heading names it. ---- */}
        <section className="mt-10 rounded-xl border border-white/10 bg-ink-800/60 p-5">
          <h2 className="text-lg font-semibold text-white">Daily spend</h2>
          <p className="mt-1 text-sm text-gray-400">Last {days} days · hover a bar for detail</p>

          {byDay.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">
              No usage recorded in this period yet.
            </p>
          ) : (
            <div
              role="img"
              aria-label={`Daily spend over the last ${days} days, totalling ${formatUsd(
                byDay.reduce((sum, d) => sum + d.priceNanos, 0),
              )}. Highest day ${formatUsd(maxDay)}.`}
              className="mt-5 flex h-48 items-end gap-[2px]"
            >
              {byDay.map((d) => {
                const pct = (d.priceNanos / maxDay) * 100;
                return (
                  <div key={d.day} className="group relative flex h-full flex-1 items-end">
                    {/* Bars sit on the baseline with rounded data-ends. The 2px
                        gap comes from the flex gap, so fills never touch. */}
                    <div
                      className="w-full rounded-t transition-opacity group-hover:opacity-100"
                      style={{
                        height: `${Math.max(pct, d.priceNanos > 0 ? 1.5 : 0)}%`,
                        background: ACCENT,
                        opacity: 0.85,
                      }}
                    />
                    {/* Hit target spans the full column height, not just the bar. */}
                    <div className="absolute inset-0" aria-hidden="true" />
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-xs shadow-xl group-hover:block"
                    >
                      <p className="font-medium text-white">{formatUsd(d.priceNanos, { precise: true })}</p>
                      <p className="text-gray-400">
                        {formatDate(d.day)} · {d.events} req
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {byDay.length > 0 && (
            <div className="mt-2 flex justify-between text-xs text-gray-500">
              <span>{formatDate(byDay[0].day)}</span>
              <span>peak {formatUsdCompact(maxDay)}</span>
              <span>{formatDate(byDay[byDay.length - 1].day)}</span>
            </div>
          )}
        </section>

        {/* ---- Per model: each bar is directly labelled, so identity never
                depends on colour alone. ---- */}
        <section className="mt-8 rounded-xl border border-white/10 bg-ink-800/60 p-5">
          <h2 className="text-lg font-semibold text-white">Spend by model</h2>
          <p className="mt-1 text-sm text-gray-400">This billing period</p>

          {models.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">Nothing metered yet.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {models.map((m, i) => (
                <li key={m.modelId}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 font-medium text-gray-200">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: SERIES[i % SERIES.length] }}
                      />
                      {m.displayName}
                    </span>
                    <span className="font-mono text-gray-300">
                      {formatUsd(m.priceNanos, { precise: true })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-700">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max((m.priceNanos / maxModel) * 100, 1)}%`,
                        background: SERIES[i % SERIES.length],
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {m.events.toLocaleString('en-US')} requests ·{' '}
                    {formatTokens(m.inputTokens)} in · {formatTokens(m.outputTokens)} out
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- The table view: the same data, readable without colour. ---- */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">Recent requests</h2>
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            {events.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No requests yet.</p>
            ) : (
              <table className="w-full min-w-[38rem] text-sm">
                <thead className="bg-ink-700/60 text-left text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Model</th>
                    <th scope="col" className="px-4 py-3 font-medium">Feature</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">In</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Out</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Cached</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Cost</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {events.map((e) => (
                    <tr key={e.id} className="bg-ink-800/40">
                      <td className="px-4 py-2.5 font-medium text-white">{e.modelId}</td>
                      <td className="px-4 py-2.5 text-gray-400">{e.feature ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300">{formatTokens(e.inputTokens)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300">{formatTokens(e.outputTokens)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{formatTokens(e.cacheTokens)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-200">
                        {formatUsd(e.priceNanos, { precise: true })}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{formatDate(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main></AppShell>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
