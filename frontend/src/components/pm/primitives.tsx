import type { ReactNode, SVGProps } from 'react';
import type { PmHealth } from '../../lib/api';

/**
 * The small shared pieces of the Project Manager screens.
 *
 * Two rules run through all of them:
 *
 *  1. **A status colour never carries meaning alone.** Every severity, band and
 *     state ships with an icon and a word. Roughly one man in twelve cannot
 *     separate the amber from the red, and a panel that only works for the other
 *     eleven is not a panel a crew can be run from.
 *  2. **Text wears text colours.** The coloured thing is the mark — the dot, the
 *     bar, the icon. Numbers and labels stay in the normal ink so the screen
 *     stays readable when several statuses are on it at once.
 */

/* ------------------------------------------------------------------ *
 * Severity
 * ------------------------------------------------------------------ */

export type Severity = 'info' | 'warn' | 'critical';

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'pm-critical' },
  warn: { label: 'Attention', className: 'pm-warning' },
  info: { label: 'For info', className: 'pm-info' },
};

export function SeverityIcon({ severity, ...props }: { severity: Severity } & SVGProps<SVGSVGElement>) {
  if (severity === 'critical') {
    // Filled octagon — distinct in silhouette from the triangle and the circle,
    // so the shape alone separates the three.
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...props}>
        <path
          d="M8.5 2.5h7L21.5 8.5v7L15.5 21.5h-7L2.5 15.5v-7L8.5 2.5Z"
          fill="currentColor"
        />
        <path d="M12 7v6" stroke="#12121d" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="1.2" fill="#12121d" />
      </svg>
    );
  }
  if (severity === 'warn') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...props}>
        <path d="M12 3.2 22 20H2L12 3.2Z" fill="currentColor" />
        <path d="M12 9.5v4.2" stroke="#12121d" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.8" r="1.15" fill="#12121d" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9.2" fill="currentColor" />
      <path d="M12 11v5.5" stroke="#12121d" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="1.15" fill="#12121d" />
    </svg>
  );
}

/** Icon + word. Never the colour on its own. */
export function SeverityTag({ severity }: { severity: Severity }) {
  const meta = SEVERITY[severity];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700">
      <SeverityIcon severity={severity} className={meta.className} />
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

const BAND: Record<PmHealth['band'], { label: string; className: string; severity: Severity }> = {
  good: { label: 'On track', className: 'pm-good', severity: 'info' },
  watch: { label: 'Watch', className: 'pm-info', severity: 'info' },
  at_risk: { label: 'At risk', className: 'pm-warning', severity: 'warn' },
  critical: { label: 'Critical', className: 'pm-critical', severity: 'critical' },
};

/**
 * The health score with its band spelled out, and the top reason as the tooltip.
 *
 * A bare number invites "why?", and if the answer needs another screen the
 * number has cost more attention than it saved — so the headline reason travels
 * with it.
 */
export function HealthPill({ health }: { health: PmHealth }) {
  const band = BAND[health.band];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-0 px-2.5 py-1 text-xs"
      title={health.reasons.map((r) => r.text).join(' · ') || 'Nothing flagged'}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${band.className}`} style={{ backgroundColor: 'currentColor' }} />
      <span className="font-medium text-ink-800">{band.label}</span>
      <span className="tabular-nums text-ink-500">{health.score}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-paper-0 p-5 ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-600">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A single number that answers one question.
 *
 * `tone` colours the number's accompanying mark, not the digits — the digits
 * stay in the normal ink so a row of tiles reads as one row rather than as
 * four competing colours.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
}) {
  const toneClass =
    tone === 'good'
      ? 'pm-good'
      : tone === 'warning'
        ? 'pm-warning'
        : tone === 'critical'
          ? 'pm-critical'
          : 'text-ink-400';
  return (
    <div className="rounded-xl border border-line bg-paper-0 p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-1.5 w-6 rounded-full ${toneClass}`}
          style={{ backgroundColor: 'currentColor' }}
        />
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * A labelled completion meter.
 *
 * The number is always written out beside the bar: a bar alone is a shape, and
 * "83%" is the thing somebody repeats on a phone call.
 */
export function Meter({
  label,
  pct,
  tone = 'brand',
  note,
}: {
  label: string;
  pct: number;
  tone?: 'brand' | 'good' | 'warning' | 'critical';
  note?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const fill =
    tone === 'good'
      ? 'var(--pm-good)'
      : tone === 'warning'
        ? 'var(--pm-warning)'
        : tone === 'critical'
          ? 'var(--pm-critical)'
          : '#818cf8';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-700">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-ink-900">{clamped}%</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-0"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%`, backgroundColor: fill }}
        />
      </div>
      {note && <p className="mt-1 text-xs text-ink-500">{note}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-ink-500">{children}</p>;
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-line bg-paper-0 px-2.5 py-1 text-xs font-medium text-ink-700 ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Drying trend
 * ------------------------------------------------------------------ */

export interface TrendPoint {
  takenAt: string;
  moisturePct: number;
}

/**
 * One area's moisture over time against its dry standard.
 *
 * A single series, so there is no legend — the caption names it. The goal line
 * is the reference the whole chart exists to be read against, so it is drawn
 * dashed and labelled rather than left to a tooltip. The readings table beneath
 * it on the project screen is the accessible equivalent: every value here is
 * also a row there.
 */
export function DryingSparkline({
  points,
  goalPct,
  state,
  width = 260,
  height = 64,
}: {
  points: TrendPoint[];
  goalPct: number;
  state: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-ink-500">
        {points.length === 1 ? 'One reading so far — no trend yet.' : 'No readings yet.'}
      </p>
    );
  }

  const values = points.map((p) => p.moisturePct);
  const max = Math.max(...values, goalPct) * 1.08;
  const min = Math.min(...values, goalPct) * 0.9;
  const span = Math.max(max - min, 0.5);

  const padX = 4;
  const padY = 6;
  const x = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / span) * (height - padY * 2);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.moisturePct).toFixed(1)}`).join(' ');
  const goalY = y(goalPct);

  const stroke =
    state === 'wetter' || state === 'stalled'
      ? 'var(--pm-warning)'
      : state === 'goal_met' || state === 'signed_off'
        ? 'var(--pm-good)'
        : '#818cf8';

  const latest = points[points.length - 1]!;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Moisture in this area over ${points.length} readings, from ${values[0]!.toFixed(1)} percent to ${latest.moisturePct.toFixed(1)} percent, against a dry standard of ${goalPct} percent.`}
      >
        {/* The dry standard — the line the whole chart is read against. */}
        <line
          x1={padX}
          x2={width - padX}
          y1={goalY}
          y2={goalY}
          stroke="#6b7280"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Only the latest point is marked — a dot on every reading is noise. */}
        <circle
          cx={x(points.length - 1)}
          cy={y(latest.moisturePct)}
          r="4"
          fill={stroke}
          stroke="#12121d"
          strokeWidth="2"
        />
      </svg>
      <figcaption className="mt-1 flex items-center justify-between text-xs text-ink-500">
        <span>Dry standard {goalPct}%</span>
        <span className="tabular-nums text-ink-700">Now {latest.moisturePct.toFixed(1)}%</span>
      </figcaption>
    </figure>
  );
}
