/**
 * Internal-only product intelligence: where time goes, what’s cold, and what
 * Atmosphere should cut / invest in / fix for stickiness.
 */

import {
  count,
  hours,
  percent,
  type ProductInsight,
  type ProductIntelligence,
} from '../../lib/analyticsApi';
import { CHART, METRIC_COLOR, SERIES } from './palette';
import { HBarChart } from './charts';
import { ChartCard, DataTable, type Column } from './ui';

const KIND_LABEL: Record<ProductInsight['kind'], string> = {
  cut: 'Cut / bury',
  invest: 'Invest',
  stickiness: 'Make stickier',
  watch: 'Watch',
};

const KIND_COLOR: Record<ProductInsight['kind'], string> = {
  cut: CHART.critical,
  invest: CHART.good,
  stickiness: SERIES[0],
  watch: SERIES[1],
};

const PRIORITY_LABEL: Record<ProductInsight['priority'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function ProductIntelligenceSection({ intel }: { intel: ProductIntelligence }) {
  const areaColumns: Column<(typeof intel.areas)[number]>[] = [
    { key: 'area', header: 'Area', render: (r) => r.area },
    { key: 'hours', header: 'Hours', align: 'right', render: (r) => hours(r.activeHours) },
    { key: 'share', header: 'Share', align: 'right', render: (r) => percent(r.sharePct) },
    {
      key: 'tools',
      header: 'Tools used',
      align: 'right',
      render: (r) => `${count(r.featuresUsed)}/${count(r.featuresTracked)}`,
    },
    { key: 'sessions', header: 'Sessions', align: 'right', render: (r) => count(r.sessions) },
  ];

  const peakAreaHours = Math.max(0, ...intel.areas.map((a) => a.activeHours));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl glass-card px-4 py-3 shadow-card">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            background:
              intel.confidence === 'high'
                ? 'rgba(21,128,61,0.12)'
                : intel.confidence === 'medium'
                  ? 'rgba(210,80,10,0.12)'
                  : 'rgba(185,28,28,0.1)',
            color:
              intel.confidence === 'high'
                ? CHART.good
                : intel.confidence === 'medium'
                  ? SERIES[0]
                  : CHART.critical,
          }}
        >
          {intel.confidence} confidence
        </span>
        <p className="text-sm text-ink-600">{intel.confidenceNote}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Where time goes"
          subtitle="Product areas ranked by foreground hours — the map of how Atmosphere is actually used."
          table={
            <DataTable
              columns={areaColumns}
              rows={intel.areas}
              rowKey={(r) => r.area}
              maxHeight="16rem"
            />
          }
        >
          {intel.areas.every((a) => a.activeHours === 0) ? (
            <p className="py-10 text-center text-sm text-ink-500">
              No area usage in this period yet.
            </p>
          ) : (
            <HBarChart
              ariaLabel="Product areas by hours spent"
              color={METRIC_COLOR.usage}
              maxValue={peakAreaHours}
              items={intel.areas.map((a) => ({
                key: a.area,
                label: a.area,
                sublabel: `${a.featuresUsed}/${a.featuresTracked} tools`,
                value: a.activeHours,
                display: `${hours(a.activeHours)} · ${percent(a.sharePct, 0)}`,
              }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Hottest vs coldest tools"
          subtitle="Top and bottom of the ranking — invest at the top, question the bottom."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ToolList title="Hottest" rows={intel.hottest} empty="Nothing used yet." hot />
            <ToolList title="Coldest" rows={intel.coldest} empty="Catalog is empty." hot={false} />
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="What to cut, what to invest in, how to get stickier"
        subtitle="Rule-based advice from this period’s usage, retention and paying-account behaviour. For the Atmosphere team only."
      >
        {intel.insights.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-500">
            Not enough signal yet for concrete recommendations. Keep telemetry flowing.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {intel.insights.map((insight) => (
              <InsightRow key={insight.id} insight={insight} />
            ))}
          </ul>
        )}
      </ChartCard>
    </div>
  );
}

function ToolList({
  title,
  rows,
  empty,
  hot,
}: {
  title: string;
  rows: ProductIntelligence['hottest'];
  empty: string;
  hot: boolean;
}) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">{empty}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {rows.map((f, i) => (
            <li key={f.featureKey} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink-800">
                <span className="mr-2 text-ink-500">{i + 1}.</span>
                {f.label}
                <span className="ml-1.5 text-xs text-ink-500">{f.area}</span>
              </span>
              <span className={hot ? 'shrink-0 font-medium text-ink-900' : 'shrink-0 text-ink-500'}>
                {hours(f.activeHours)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function InsightRow({ insight }: { insight: ProductInsight }) {
  return (
    <li className="flex gap-4 py-4 first:pt-1 last:pb-1">
      <div className="w-28 shrink-0 space-y-1.5">
        <span
          className="inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            color: KIND_COLOR[insight.kind],
            background: `${KIND_COLOR[insight.kind]}18`,
          }}
        >
          {KIND_LABEL[insight.kind]}
        </span>
        <p className="text-[11px] uppercase tracking-wide text-ink-500">
          {PRIORITY_LABEL[insight.priority]} priority
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink-900">{insight.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">{insight.rationale}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-800">
          <span className="font-semibold text-brand-600">Do this: </span>
          {insight.action}
        </p>
      </div>
    </li>
  );
}
