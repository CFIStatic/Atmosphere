import { useEffect, useMemo, useState } from 'react';
import { api, tokenUsageRange } from '../lib/api';
import type { AiReconciliationPayload, AiReconciliationProvider } from '../lib/types';
import { asOf } from '../lib/format';
import { ErrorLine, Footnotes, KpiStrip, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';

const USD_FINE = '"$"#,##0.0000';

function dayStatus(p: AiReconciliationProvider, d: AiReconciliationProvider['days'][number]): string {
  if (d.flagged) return 'Over threshold';
  if (d.pending) return 'Provider pending';
  if (d.theirsUsd === null) return p.status === 'connected' ? '' : p.status === 'unsupported' ? 'Manual check' : 'Not connected';
  return 'OK';
}

/** Every provider's daily rows in one sheet, with a totals row per provider. */
function reconciliationSheet(name: string, providers: AiReconciliationProvider[]): ExportSheet {
  return {
    name,
    columns: [
      { header: 'Provider' },
      { header: 'Connection' },
      { header: 'Day (UTC)', type: 'date' },
      { header: 'Our recorded cost, USD', type: 'usd', format: USD_FINE },
      { header: 'Provider billed, USD', type: 'usd', format: USD_FINE },
      { header: 'Variance, USD', type: 'usd', format: USD_FINE },
      { header: 'Variance', type: 'percent', format: '0.00%' },
      { header: 'Status' },
    ],
    rows: providers.flatMap((p) => [
      ...p.days.map((d) => [
        p.label,
        STATUS_TEXT[p.status],
        d.day,
        d.oursUsd,
        d.theirsUsd,
        d.varianceUsd,
        d.variancePct,
        dayStatus(p, d),
      ]),
      [
        p.label,
        STATUS_TEXT[p.status],
        'Total (settled days)',
        p.totals.oursUsd,
        p.totals.theirsUsd,
        p.totals.varianceUsd,
        p.totals.variancePct,
        p.totals.flagged ? 'Over threshold' : '',
      ],
    ]),
  };
}

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
    <Section
      testId={`recon-${p.provider}`}
      title={p.label}
      note={p.source}
      actions={
        <DownloadButton
          table={`ai-reconciliation-${p.provider}`}
          label={`${p.label} daily reconciliation`}
          sheets={() => [reconciliationSheet(p.label, [p])]}
        />
      }
    >
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
      <div className="overflow-x-auto">
      <table className="report-table min-w-[560px]">
        <thead>
          <tr>
            <th>Day (UTC)</th>
            <th className="num">Our recorded cost</th>
            <th className="num">Provider billed</th>
            <th className="num">Variance</th>
            <th className="num">Status</th>
          </tr>
        </thead>
        <tbody>
          {p.days.map((d) => (
            <tr
              key={d.day}
              className={d.flagged ? '[&>td]:bg-danger-50 [&>td]:text-danger-600' : ''}
              data-flagged={d.flagged ? 'true' : undefined}
            >
              <td className="tabular-nums">{d.day}</td>
              <td className="num">{usd(d.oursUsd)}</td>
              <td className="num">
                {p.status === 'connected' ? usd(d.theirsUsd) : p.status === 'unsupported' ? 'Manual check' : 'Not connected'}
              </td>
              <td className="num">{variance(d.variancePct, d.varianceUsd)}</td>
              <td className="num text-[11.5px]">
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
          <tr className={`font-semibold ${p.totals.flagged ? 'text-danger-600' : 'text-ink-900'}`}>
            <td className="px-3 py-2">Total (settled days)</td>
            <td className="px-3 py-2 text-right tabular-nums">{usd(p.totals.oursUsd)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{p.status === 'connected' ? usd(p.totals.theirsUsd) : '—'}</td>
            <td className="px-3 py-2 text-right tabular-nums">{variance(p.totals.variancePct, p.totals.varianceUsd)}</td>
            <td className="px-3 py-2 text-right text-[11.5px]">{p.totals.flagged ? 'Over threshold' : ''}</td>
          </tr>
        </tfoot>
      </table>
      </div>
    </Section>
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

  if (!data && !error) return <Loading label="Loading reconciliation" />;

  return (
    <div>
      <PageHeader
        eyebrow="AI cost & usage"
        title="AI cost reconciliation"
        subtitle={`Our recorded provider cost (provider-reported tokens × official rate card) per provider per UTC day, against what each provider says it billed. Days more than ±${data?.thresholdPct ?? 2}% apart are flagged. Customer charges are this cost × markup, so a variance here is a billing variance.`}
        actions={
          data ? (
            <DownloadButton
              table="ai-reconciliation-all-providers"
              label="reconciliation for all providers"
              sheets={() => [reconciliationSheet('All providers', data.providers)]}
            />
          ) : undefined
        }
      />
      {error && <ErrorLine message={error} />}
      {data && (
        <>
          <p className="mt-3 text-[12px] text-ink-600" data-testid="recon-window">
            <span className="font-semibold text-ink-800">Rolling 30 days (UTC)</span> ·{' '}
            {data.window.from.slice(0, 10)} to {data.window.to.slice(0, 10)} · generated {asOf(data.generatedAt)}
          </p>
          <KpiStrip
            items={[
              { label: 'Our recorded AI cost', unit: 'All providers, this window', value: usd(ours), raw: ours, rawType: 'usd' },
              {
                label: 'Providers connected',
                unit: 'Admin keys / billing exports',
                value: `${connected} of ${data.providers.length}`,
                raw: connected,
                rawType: 'integer',
              },
              {
                label: `Flags over ±${data.thresholdPct}%`,
                unit: data.flaggedCount ? 'Investigate before invoicing' : 'Nothing flagged',
                value: String(data.flaggedCount),
                raw: data.flaggedCount,
                rawType: 'integer',
              },
            ]}
          />
          {data.providers.map((p) => (
            <ProviderSection key={p.provider} p={p} threshold={data.thresholdPct} />
          ))}
          <Footnotes
            notes={[
              'Our side: token_usage_events.cost_nanos summed per provider per UTC day. Providers not listed above (for example Browserbase sessions used by Computer) are included in "Our recorded AI cost" but are not reconciled: there is no provider cost API wired up for them, so check their invoices by hand.',
            ]}
          />
        </>
      )}
    </div>
  );
}
