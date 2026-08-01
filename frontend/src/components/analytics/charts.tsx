/**
 * The chart kit for the analytics dashboards.
 *
 * Hand-rolled SVG rather than a charting dependency: the shapes needed here are
 * few, and this keeps full control of the mark specs (thin strokes, hairline
 * grid, 2px surface gaps, selective direct labels) that make a dashboard read as
 * one system.
 *
 * Rules that hold everywhere in this file:
 *  - one y-axis, ever. Two measures of different magnitude get two charts.
 *  - a legend whenever there are two or more series; a single series is named by
 *    the card title instead.
 *  - hover and keyboard focus reveal the SAME values, and every chart has a
 *    table twin (see ChartCard) so no value is reachable only by pointer.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHART, SEQUENTIAL, SEQUENTIAL_DARK_TEXT_FROM } from './palette';

/** Measure the container so marks land on whole pixels instead of being scaled. */
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** A "nice" axis maximum, so ticks land on readable numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

interface Tooltip {
  index: number;
  x: number;
  y: number;
}

function TooltipCard({
  label,
  rows,
  x,
  containerWidth,
}: {
  label: string;
  rows: { color?: string; name: string; value: string }[];
  x: number;
  containerWidth: number;
}) {
  // Flip the card to the other side of the cursor near the right edge so it is
  // never clipped by the card.
  const flip = x > containerWidth - 150;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[9rem] rounded-lg border border-white/10 bg-ink-900/95 px-3 py-2 shadow-xl backdrop-blur"
      style={{ left: flip ? undefined : x + 12, right: flip ? containerWidth - x + 12 : undefined, top: 8 }}
      role="status"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-gray-400">
              {row.color && (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
              )}
              {row.name}
            </span>
            <span className="font-medium tabular-nums text-white">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  format: (value: number) => string;
}

/**
 * Lines over time. Up to three series on ONE axis — if two measures do not share
 * a scale they belong in two charts, not on two axes.
 */
export function TimeSeriesChart({
  labels,
  series,
  height = 220,
  formatTick,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  formatTick: (value: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Tooltip | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const pad = { top: 12, right: 16, bottom: 26, left: 52 };
  const plotWidth = Math.max(width - pad.left - pad.right, 10);
  const plotHeight = height - pad.top - pad.bottom;

  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const stepX = labels.length > 1 ? plotWidth / (labels.length - 1) : 0;

  const xAt = (index: number) => pad.left + index * stepX;
  const yAt = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;

  const active = hover?.index ?? focusIndex;

  const handleMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const index = Math.max(
        0,
        Math.min(labels.length - 1, Math.round((x - pad.left) / (stepX || 1))),
      );
      setHover({ index, x: xAt(index), y: 0 });
    },
    [labels.length, stepX], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Thin x labels so they never collide, whatever the container width.
  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotWidth / 64))));

  if (labels.length === 0) return <div ref={ref} style={{ height }} />;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setFocusIndex(labels.length - 1)}
          onBlur={() => setFocusIndex(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setFocusIndex((current) => {
                const base = current ?? labels.length - 1;
                return Math.max(0, Math.min(labels.length - 1, base + (event.key === 'ArrowRight' ? 1 : -1)));
              });
            }
          }}
        >
          {/* Gridlines: solid hairlines, one shade off the surface. */}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = pad.top + plotHeight * fraction;
            return (
              <g key={fraction}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={CHART.grid} strokeWidth={1} />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill={CHART.muted}>
                  {formatTick(max * (1 - fraction))}
                </text>
              </g>
            );
          })}

          {labels.map((label, index) =>
            index % labelEvery === 0 || index === labels.length - 1 ? (
              <text
                key={label + index}
                x={xAt(index)}
                y={height - 8}
                textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}
                fontSize={10}
                fill={CHART.muted}
              >
                {label}
              </text>
            ) : null,
          )}

          {series.map((s) => {
            const points = s.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ');
            const areaPoints = `${pad.left},${pad.top + plotHeight} ${points} ${xAt(
              s.values.length - 1,
            )},${pad.top + plotHeight}`;
            return (
              <g key={s.key}>
                {series.length === 1 && (
                  <>
                    <defs>
                      <linearGradient id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <polygon points={areaPoints} fill={`url(#fill-${s.key})`} />
                  </>
                )}
                <polyline
                  points={points}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Direct-label the endpoint only — a number on every point is chaos. */}
                {s.values.length > 0 && (
                  <circle
                    cx={xAt(s.values.length - 1)}
                    cy={yAt(s.values[s.values.length - 1])}
                    r={3.5}
                    fill={s.color}
                    stroke={CHART.surface}
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}

          {active !== null && (
            <g>
              <line
                x1={xAt(active)}
                x2={xAt(active)}
                y1={pad.top}
                y2={pad.top + plotHeight}
                stroke={CHART.axis}
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={xAt(active)}
                  cy={yAt(s.values[active] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke={CHART.surface}
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>
      )}

      {active !== null && labels[active] !== undefined && (
        <TooltipCard
          label={labels[active]}
          x={xAt(active)}
          containerWidth={width}
          rows={series.map((s) => ({
            color: series.length > 1 ? s.color : undefined,
            name: s.label,
            value: s.format(s.values[active] ?? 0),
          }))}
        />
      )}
    </div>
  );
}

/** Vertical columns for a discrete per-month measure (revenue collected). */
export function ColumnChart({
  labels,
  values,
  color,
  format,
  formatTick,
  height = 200,
  ariaLabel,
}: {
  labels: string[];
  values: number[];
  color: string;
  format: (value: number) => string;
  formatTick: (value: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const pad = { top: 12, right: 8, bottom: 26, left: 52 };
  const plotWidth = Math.max(width - pad.left - pad.right, 10);
  const plotHeight = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...values));

  const slot = values.length > 0 ? plotWidth / values.length : plotWidth;
  // A 2px surface gap separates neighbours — never a stroke around the mark.
  const barWidth = Math.max(2, Math.min(28, slot - 2));
  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotWidth / 64))));

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {[0, 0.5, 1].map((fraction) => {
            const y = pad.top + plotHeight * fraction;
            return (
              <g key={fraction}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={CHART.grid} strokeWidth={1} />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill={CHART.muted}>
                  {formatTick(max * (1 - fraction))}
                </text>
              </g>
            );
          })}

          {values.map((value, index) => {
            const barHeight = Math.max(0, (value / max) * plotHeight);
            const x = pad.left + index * slot + (slot - barWidth) / 2;
            const y = pad.top + plotHeight - barHeight;
            return (
              <g key={labels[index] + index}>
                {/* Hit target spans the whole slot, not just the bar. */}
                <rect
                  x={pad.left + index * slot}
                  y={pad.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                />
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={Math.min(4, barWidth / 2)}
                  fill={color}
                  opacity={active === null || active === index ? 1 : 0.45}
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {labels.map((label, index) =>
            index % labelEvery === 0 || index === labels.length - 1 ? (
              <text
                key={label + index}
                x={pad.left + index * slot + slot / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill={CHART.muted}
              >
                {label}
              </text>
            ) : null,
          )}
        </svg>
      )}

      {active !== null && (
        <TooltipCard
          label={labels[active]}
          x={pad.left + active * slot + slot / 2}
          containerWidth={width}
          rows={[{ name: 'Value', value: format(values[active]) }]}
        />
      )}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  display: string;
  /** Optional muted note shown when the value is zero (e.g. "never opened"). */
  emptyNote?: string;
}

/**
 * Horizontal bars for ranked categories.
 *
 * One series, one colour — a value ramp across nominal categories would
 * double-encode length as hue and burn the only free channel. Emphasis is done
 * with opacity, not with a second hue.
 */
export function HBarChart({
  items,
  color,
  ariaLabel,
  highlightKey,
  maxValue,
}: {
  items: BarItem[];
  color: string;
  ariaLabel: string;
  highlightKey?: string | null;
  /**
   * Scale bars against an external maximum. Two charts showing slices of the
   * same measure MUST share a scale — otherwise the largest of the small values
   * renders as a full-width bar and reads as "heavily used", which is the exact
   * opposite of what a "least used" chart is there to say.
   */
  maxValue?: number;
}) {
  const max = Math.max(1, maxValue ?? 0, ...items.map((item) => item.value));

  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = (item.value / max) * 100;
        const dimmed = highlightKey ? item.key !== highlightKey : false;
        return (
          <li key={item.key} className="group">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-gray-300">
                {item.label}
                {item.sublabel && (
                  <span className="ml-2 text-xs text-gray-600">{item.sublabel}</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums text-white">
                {item.value > 0 ? item.display : <span className="text-gray-600">{item.emptyNote ?? item.display}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(pct, item.value > 0 ? 1.5 : 0)}%`,
                  backgroundColor: color,
                  opacity: dimmed ? 0.35 : 1,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cohort retention as a single-hue grid. Magnitude gets one hue light→dark;
 * the percentage is printed in every cell so the colour is never the only
 * channel carrying the value.
 */
export function RetentionGrid({
  cohorts,
}: {
  cohorts: { label: string; size: number; cells: (number | null)[] }[];
}) {
  const maxOffset = Math.max(0, ...cohorts.map((c) => c.cells.length - 1));
  const offsets = Array.from({ length: maxOffset + 1 }, (_, i) => i);

  /** Six steps of one hue; the darkest still reads as a filled cell. */
  const stepFor = (value: number | null): number | null =>
    value === null
      ? null
      : Math.min(SEQUENTIAL.length - 1, Math.max(0, Math.floor((value / 100) * (SEQUENTIAL.length - 1))));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">
          Share of each signup cohort still active in later months
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-medium text-gray-500">
              Cohort
            </th>
            <th scope="col" className="px-2 py-1 text-right font-medium text-gray-500">
              Orgs
            </th>
            {offsets.map((offset) => (
              <th key={offset} scope="col" className="px-1 py-1 text-center font-medium text-gray-500">
                M{offset}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.label}>
              <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-normal text-gray-400">
                {cohort.label}
              </th>
              <td className="px-2 py-1 text-right tabular-nums text-gray-400">{cohort.size}</td>
              {offsets.map((offset) => {
                const value = cohort.cells[offset] ?? null;
                const step = stepFor(value);
                return (
                  <td
                    key={offset}
                    className="rounded px-1 py-1 text-center tabular-nums"
                    style={{
                      backgroundColor: step === null ? 'transparent' : SEQUENTIAL[step],
                      // The value is printed in every cell, so colour is never
                      // the only channel — but it has to stay readable on the
                      // pale end of the ramp.
                      color:
                        step === null
                          ? CHART.muted
                          : step >= SEQUENTIAL_DARK_TEXT_FROM
                            ? CHART.onLight
                            : CHART.ink,
                    }}
                  >
                    {value === null ? '·' : `${Math.round(value)}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shared legend. Present whenever a chart carries two or more series. */
export function Legend({ series }: { series: { label: string; color: string }[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Reduced-motion-aware mount animation used by the dashboard cards. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return reduced;
}
