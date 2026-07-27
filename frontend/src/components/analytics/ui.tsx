/**
 * Layout and non-chart primitives for the analytics dashboards.
 *
 * ChartCard is where the accessibility contract lives: every chart ships with a
 * table twin behind a toggle, so no value is reachable by pointer alone.
 */

import { useId, useState, type ReactNode } from 'react';
import { CHART } from './palette';

/* ------------------------------------------------------------------ tiles */

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  footnote,
  tone = 'default',
}: {
  label: string;
  value: string;
  /** Signed percentage change; drives the arrow and its colour. */
  delta?: number | null;
  deltaLabel?: string;
  footnote?: string;
  tone?: 'default' | 'headline';
}) {
  const hasDelta = delta !== undefined && delta !== null;
  const up = hasDelta && delta > 0;
  const flat = hasDelta && delta === 0;

  return (
    <div
      className={`rounded-xl border border-white/10 p-4 backdrop-blur ${
        tone === 'headline' ? 'bg-brand-600/10' : 'bg-ink-800/60'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      {/* Proportional figures on a display-size number; tabular-nums here would
          make the digits look loose. */}
      <p
        className={`mt-1.5 font-semibold text-white ${
          tone === 'headline' ? 'text-3xl' : 'text-2xl'
        }`}
      >
        {value}
      </p>
      {(hasDelta || deltaLabel) && (
        <p className="mt-1 flex items-center gap-1.5 text-xs">
          {hasDelta && (
            <span
              className="flex items-center gap-0.5 font-medium"
              style={{ color: flat ? CHART.muted : up ? CHART.good : CHART.critical }}
            >
              {/* Icon + sign, so the meaning never rests on colour alone. */}
              <span aria-hidden>{flat ? '→' : up ? '↑' : '↓'}</span>
              {`${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
            </span>
          )}
          {deltaLabel && <span className="text-gray-500">{deltaLabel}</span>}
        </p>
      )}
      {footnote && <p className="mt-1 text-xs text-gray-600">{footnote}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

export function ChartCard({
  title,
  subtitle,
  legend,
  action,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  action?: ReactNode;
  /** The WCAG-clean twin of the chart. Rendered in place of it when toggled. */
  table?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const bodyId = useId();

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {legend}
          {action}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((current) => !current)}
              aria-expanded={showTable}
              aria-controls={bodyId}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-gray-400 transition hover:bg-white/5 hover:text-gray-200"
            >
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </header>
      <div id={bodyId}>{showTable && table ? table : children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- tables */

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  maxHeight?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="w-full min-w-full text-sm">
        <thead className="sticky top-0 bg-ink-800/95 backdrop-blur">
          <tr className="border-b border-white/10">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 ${
                  column.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition hover:bg-white/[0.03]">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`whitespace-nowrap px-3 py-2 ${
                    column.align === 'right' ? 'text-right tabular-nums text-gray-300' : 'text-gray-300'
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- filters */

export const RANGE_PRESETS = [
  { key: '30d', label: 'Last 30 days', days: 30, months: 12 },
  { key: '90d', label: 'Last 90 days', days: 90, months: 18 },
  { key: '12m', label: 'Last 12 months', days: 365, months: 24 },
  { key: 'all', label: 'All time', days: 365 * 5, months: 60 },
] as const;

export type RangePresetKey = (typeof RANGE_PRESETS)[number]['key'];

/** One filter row above everything it scopes — never a filter inside a card. */
export function RangeFilter({
  value,
  onChange,
  disabled,
}: {
  value: RangePresetKey;
  onChange: (key: RangePresetKey) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-white/10 bg-ink-800/60 p-0.5"
      role="group"
      aria-label="Reporting period"
    >
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(preset.key)}
          aria-pressed={value === preset.key}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            value === preset.key
              ? 'bg-brand-600 text-white'
              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- download */

export function DownloadExcel({
  href,
  label = 'Download Excel',
  compact = false,
}: {
  href: string;
  label?: string;
  compact?: boolean;
}) {
  return (
    <a
      href={href}
      // The server sets Content-Disposition; `download` keeps Safari honest.
      download
      className={
        compact
          ? 'rounded-md border border-white/10 px-2 py-1 text-xs text-gray-400 transition hover:bg-white/5 hover:text-gray-200'
          : 'inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500'
      }
    >
      <svg width={compact ? 12 : 15} height={compact ? 12 : 15} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 1.5v8m0 0L5 6.5m3 3 3-3M2.5 11v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </a>
  );
}

/* ----------------------------------------------------------------- states */

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-ink-800/40 px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-300">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-500">{body}</p>
    </div>
  );
}

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4 mt-10 flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
