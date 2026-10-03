import { useEffect, useMemo, useState } from 'react';
import { api, tokenUsageRange } from '../lib/api';
import type { AiReconciliationPayload, AiReconciliationProvider } from '../lib/types';
import { asOf } from '../lib/format';
import { SectionHeading, StatTile } from '../components/ui';

/** USD with enough places for per-day AI cost (sub-cent amounts are common). */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return `${value < 0 ? '−' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function variance(pct: number | null, usdDiff: number | null): string {
  if (pct !== null) return `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toFixed(2)}%`;
  if (usdDiff !== null && usdDiff !== 0) return `${usdDiff > 0 ? '+' : '−'}${usd(Math.abs(usdDiff))}`;
  return usdDiff === 0 ? '0.00%' : '—';
}

const STATUS_TEXT: Record<AiReconciliationProvider['status'], string> = {
  connected: 'Connected',
  not_connected: 'Not connected',
  error: 'Error',
  unsupported: 'Manual',
};

function StatusMark({ status }: { status: AiReconciliationProvider['status'] }) {
  const tone =
    status === 'connected'
      ? 'border-success-600/40 text-success-600'
      : status === 'error'
        ? 'border-danger-600/40 text-danger-600'
        : 'border-line-strong text-ink-600';
  return (
    <span
      data-testid="recon-status"
      className={`inline-block whitespace-nowrap border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}
    >
      {STATUS_TEXT[status]}
    </span>
  );
}

function ProviderSection({ p, threshold }: { p: AiReconciliationProvider; threshold: number }) {
  const flaggedDays = p.days.filter((d) => d.flagged).length;
  return (
    <section data-testid={`recon-${p.provider}`} className="mt-10">
      <SectionHeading title={p.label} hint={p.source} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-ink-600">
        <StatusMark status={p.status} />
        {p.status === 'connected' && (
          <span className={flaggedDays || p.totals.flagged ? 'font-semibold text-danger-600' : 'text-success-600'}>
            {flaggedDays || p.totals.flagged
              ? `${flaggedDays} day${flaggedDays === 1 ? '' : 's'} over ±${threshold}%`
              : `Within ±${threshold}%`}
          </span>
        )}
        {p.error && <span className="text-danger-600">{p.error}</span>}
      </div>
      {p.requires.length > 0 && (
        <div className="mb-3 border-l-2 border-line-strong pl-3 text-[12.5px] text-ink-700" data-testid="recon-requires">
          <p className="font-semibold">
            {p.status === 'unsupported' ? 'No provider cost API.' : 'To compare against provider billing, provide:'}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {p.requires.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {p.note && <p className="mb-3 text-[11.5px] text-ink-500">{p.note}</p>}
      <table className="w-full border-t border-line-strong text-[13px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-ink-500">
          <tr className="border-b border-line">
            <th className="py-2 pr-4">Day (UTC)</th>
            <th className="py-2 pr-4 text-right">Our recorded cost</th>
            <th className="py-2 pr-4 text-right">Provider billed</th>
            <th className="py-2 pr-4 text-right">Variance</th>
            <th className="py-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {p.days.map((d) => (
            <tr
              key={d.day}
              className={`border-b border-line ${d.flagged ? 'bg-danger-50 text-danger-600' : ''}`}
              data-flagged={d.flagged ? 'true' : undefined}
            >
              <td className="py-1.5 pr-4 tabular-nums">{d.day}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{usd(d.oursUsd)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">
                {p.status === 'connected' ? usd(d.theirsUsd) : p.status === 'unsupported' ? 'Manual check' : 'Not connected'}
              </td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{variance(d.variancePct, d.varianceUsd)}</td>
              <td className="py-1.5 text-right text-[11.5px]">
                {d.flagged ? 'Over threshold' : d.pending ? 'Provider pending' : d.theirsUsd === null ? '—' : 'OK'}
              </td>
            </tr>
          ))}
          {p.days.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-ink-500">
                No recorded cost in this window.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className={`font-semibold ${p.totals.flagged ? 'text-danger-600' : ''}`}>
            <td className="py-2 pr-4">Total (settled days)</td>
            <td className="py-2 pr-4 text-right tabular-nums">{usd(p.totals.oursUsd)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{p.status === 'connected' ? usd(p.totals.theirsUsd) : '—'}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{variance(p.totals.variancePct, p.totals.varianceUsd)}</td>
            <td className="py-2 text-right text-[11.5px]">{p.totals.flagged ? 'Over threshold' : ''}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

export function AiReconciliationPage() {
  const range = useMemo(() => tokenUsageRange('30d'), []);
  const [data, setData] = useState<AiReconciliationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .aiReconciliation(range)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the reconciliation');
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const connected = data?.providers.filter((p) => p.status === 'connected').length ?? 0;
  // Every recorded day, including days the provider has not reported yet.
  const ours = data?.providers.reduce((a, p) => a + p.days.reduce((s, d) => s + d.oursUsd, 0), 0) ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">AI cost reconciliation</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-500">
        Our recorded provider cost (provider-reported tokens × official rate card) per provider per UTC day, against
        what each provider says it billed. Days more than ±{data?.thresholdPct ?? 2}% apart are flagged. Customer
        charges are this cost × markup, so a variance here is a billing variance.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}
      {!data && !error && <p className="mt-6 text-sm text-ink-500">Loading reconciliation…</p>}
      {data && (
        <>
          <p className="mt-3 text-[12px] text-ink-600" data-testid="recon-window">
            <span className="font-semibold text-ink-800">Rolling 30 days (UTC)</span> ·{' '}
            {data.window.from.slice(0, 10)} to {data.window.to.slice(0, 10)} · generated {asOf(data.generatedAt)}
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatTile label="Our recorded AI cost" value={usd(ours)} footnote="All providers, this window" />
            <StatTile
              label="Providers connected"
              value={`${connected} of ${data.providers.length}`}
              footnote="Admin keys / billing exports"
            />
            <StatTile
              label={`Flags over ±${data.thresholdPct}%`}
              value={String(data.flaggedCount)}
              footnote={data.flaggedCount ? 'Investigate before invoicing' : 'Nothing flagged'}
            />
          </div>
          {data.providers.map((p) => (
            <ProviderSection key={p.provider} p={p} threshold={data.thresholdPct} />
          ))}
        </>
      )}
    </div>
  );
}
