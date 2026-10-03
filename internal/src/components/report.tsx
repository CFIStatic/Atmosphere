/**
 * Atmosphere Analytics report primitives.
 *
 * Pitch-book conventions: Arial throughout, thin rules instead of cards, every
 * label carries its unit and period, every number is tabular and
 * right-aligned in tables, red/green only on deltas, footnoted sources and an
 * as-of stamp on every page.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { asOf } from '../lib/format';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  asOfValue,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  asOfValue?: string | null;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b-2 border-rule pb-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1 text-[26px] leading-tight text-ink-900 sm:text-[30px]">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-3xl text-[13px] text-ink-600">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          {asOfValue !== undefined && (
            <p className="text-[11.5px] text-ink-500" data-testid="as-of">
              As of {asOfValue ? asOf(asOfValue) : '—'}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}

export function Section({
  title,
  note,
  children,
  id,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="mt-10" id={id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line-strong pb-1.5">
        <h2 className="text-[17px] text-ink-900">{title}</h2>
        {note && <p className="text-[11.5px] text-ink-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export type DeltaFormat = 'pct' | 'pts' | 'abs';

/**
 * Signed change, coloured red/green. `goodWhen="down"` for metrics where a
 * fall is good (latency, error rate). Null renders "n/a" in neutral ink.
 */
export function Delta({
  value,
  format = 'pct',
  goodWhen = 'up',
  digits = 1,
  unit = '',
}: {
  value: number | null | undefined;
  format?: DeltaFormat;
  goodWhen?: 'up' | 'down';
  digits?: number;
  unit?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-ink-400">n/a</span>;
  }
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  const abs = Math.abs(rounded).toFixed(digits);
  const suffix = format === 'pct' ? '%' : format === 'pts' ? ' pts' : unit;
  const good = rounded === 0 ? null : (rounded > 0) === (goodWhen === 'up');
  const tone = good === null ? 'text-ink-500' : good ? 'text-success-600' : 'text-danger-600';
  return (
    <span className={`tabular-nums ${tone}`}>
      {sign}
      {abs}
      {suffix}
    </span>
  );
}

export interface KpiItem {
  label: string;
  /** Unit and period, e.g. "USD, as of Oct 2" or "hrs / seat, wk of Sep 21". */
  unit: string;
  value: string;
  delta?: ReactNode;
  comparison?: string;
  note?: string;
  /** Detail page for this figure; the whole cell becomes the link. */
  to?: string;
}

/** The crisp strip at the top of a page: hairline-divided cells, no cards. */
export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <dl
      className="mt-5 grid grid-cols-2 border-b border-line-strong sm:grid-cols-3 lg:grid-cols-6"
      data-testid="kpi-strip"
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="relative border-l border-line px-3 py-3 first:border-l-0 sm:px-4 [&:nth-child(2n+1)]:border-l-0 sm:[&:nth-child(2n+1)]:border-l sm:[&:nth-child(3n+1)]:border-l-0 lg:[&:nth-child(3n+1)]:border-l lg:[&:nth-child(6n+1)]:border-l-0"
        >
          <dt>
            {item.to ? (
              <Link
                to={item.to}
                className="block text-[11.5px] font-semibold text-ink-800 after:absolute after:inset-0 hover:text-brand-600 hover:underline hover:underline-offset-2"
              >
                {item.label}
              </Link>
            ) : (
              <span className="block text-[11.5px] font-semibold text-ink-800">{item.label}</span>
            )}
            <span className="block text-[10.5px] text-ink-500">{item.unit}</span>
          </dt>
          <dd className="mt-2 text-[24px] font-semibold leading-none tracking-tight text-ink-900 tabular-nums">
            {item.value}
          </dd>
          {(item.delta || item.comparison) && (
            <dd className="mt-1.5 text-[11px] text-ink-500">
              {item.delta} {item.comparison && <span>{item.comparison}</span>}
            </dd>
          )}
          {item.note && <dd className="mt-1 text-[10.5px] text-ink-400">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

export interface ChartSeries {
  label: string;
  points: Array<{ x: string; y: number | null }>;
  /** Primary series draws in the accent; others in muted ink. */
  primary?: boolean;
  /** Draw the last point hollow (e.g. a partial week). */
  lastPartial?: boolean;
}

/**
 * Sober line chart: hairline gridlines at three values, thin lines, the last
 * value labelled directly at the line end, no legend.
 */
export function LineChart({
  series,
  format,
  height = 180,
  ariaLabel,
  xLabel,
}: {
  series: ChartSeries[];
  format: (value: number) => string;
  height?: number;
  ariaLabel: string;
  xLabel?: (x: string) => string;
}) {
  const width = 640;
  const pad = { top: 12, right: 104, bottom: 22, left: 44 };
  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v !== null);
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  if (all.length < 2 || xs.length < 2) {
    return (
      <p className="py-8 text-center text-[12px] text-ink-500">
        Not enough history to chart yet.
      </p>
    );
  }
  const max = Math.max(...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const top = max + span * 0.08;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (i / (xs.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - ((v - min) / (top - min)) * innerH;
  const grid = [min, min + (top - min) / 2, top];
  const tickEvery = Math.max(1, Math.ceil(xs.length / 6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full max-w-[820px]"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMinYMin meet"
    >
      {grid.map((g, i) => (
        <g key={i}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(g)}
            y2={y(g)}
            className={i === 0 ? 'stroke-line-strong' : 'stroke-line'}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text x={pad.left - 6} y={y(g) + 3.5} textAnchor="end" className="fill-ink-400 text-[10px]">
            {format(g)}
          </text>
        </g>
      ))}
      {xs.map((label, i) =>
        (i % tickEvery === 0 && xs.length - 1 - i >= tickEvery * 0.6) || i === xs.length - 1 ? (
          <text
            key={label}
            x={x(i)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}
            className="fill-ink-500 text-[10px]"
          >
            {xLabel ? xLabel(label) : label}
          </text>
        ) : null,
      )}
      {series.map((s) => {
        const pts = s.points
          .map((p, i) => (p.y === null ? null : [x(i), y(p.y)] as const))
          .filter((p): p is readonly [number, number] => p !== null);
        if (pts.length === 0) return null;
        const solid = s.lastPartial ? pts.slice(0, -1) : pts;
        const last = pts[pts.length - 1]!;
        const lastValue = [...s.points].reverse().find((p) => p.y !== null)?.y ?? null;
        const tone = s.primary ? 'stroke-brand-500' : 'stroke-ink-400';
        return (
          <g key={s.label}>
            <polyline
              fill="none"
              className={tone}
              strokeWidth={s.primary ? 1.75 : 1.25}
              strokeLinejoin="round"
              points={solid.map((p) => p.join(',')).join(' ')}
            />
            {s.lastPartial && pts.length >= 2 && (
              <line
                x1={pts[pts.length - 2]![0]}
                y1={pts[pts.length - 2]![1]}
                x2={last[0]}
                y2={last[1]}
                className={tone}
                strokeWidth={1.25}
                strokeDasharray="3 3"
              />
            )}
            <circle
              cx={last[0]}
              cy={last[1]}
              r={2.75}
              className={s.lastPartial ? `fill-paper-0 ${tone}` : s.primary ? 'fill-brand-500' : 'fill-ink-400'}
              strokeWidth={1.25}
            />
            <text
              x={last[0] + 6}
              y={last[1] + 3.5}
              className={`text-[10.5px] ${s.primary ? 'fill-ink-900 font-semibold' : 'fill-ink-500'}`}
            >
              {lastValue !== null ? format(lastValue) : ''} {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Numbered sources and definitions under a page. */
export function Footnotes({ notes, asOfValue }: { notes: ReactNode[]; asOfValue?: string | null }) {
  return (
    <footer className="mt-12 border-t border-line-strong pt-3 text-[11px] leading-relaxed text-ink-500">
      <p className="eyebrow mb-1.5">Sources and definitions</p>
      <ol className="list-none space-y-1 p-0">
        {notes.map((note, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-4 shrink-0 text-right tabular-nums">{i + 1}.</span>
            <span>{note}</span>
          </li>
        ))}
      </ol>
      {asOfValue !== undefined && (
        <p className="mt-2">Report generated {asOfValue ? asOf(asOfValue) : '—'}.</p>
      )}
    </footer>
  );
}

/** Superscript footnote marker. */
export function Fn({ n }: { n: number }) {
  return <sup className="ml-0.5 text-[9px] font-normal text-ink-500">{n}</sup>;
}

/** Honest placeholder for a metric that has no data source yet. */
export function NotTracked({ children }: { children?: ReactNode }) {
  return (
    <span className="text-[12px] italic text-ink-500" data-testid="not-tracked">
      Not tracked yet{children ? <>. {children}</> : null}
    </span>
  );
}

export function Loading({ label = 'Loading report' }: { label?: string }) {
  return <p className="mt-8 text-[13px] text-ink-500">{label}…</p>;
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p className="mt-4 border-l-2 border-danger-600 pl-3 text-[13px] text-danger-600" role="alert">
      {message}{' '}
      {onRetry && (
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </p>
  );
}

/** Small uppercase status text with a hairline box. No pills. */
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'accent' }) {
  const cls =
    tone === 'good'
      ? 'border-success-600/40 text-success-600'
      : tone === 'bad'
        ? 'border-danger-600/40 text-danger-600'
        : tone === 'accent'
          ? 'border-brand-500/50 text-brand-600'
          : 'border-line-strong text-ink-600';
  return (
    <span className={`inline-block whitespace-nowrap border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${cls}`}>
      {children}
    </span>
  );
}
