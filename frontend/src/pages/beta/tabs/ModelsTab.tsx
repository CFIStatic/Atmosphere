/**
 * Model / AI metering performance — cost by model, customer, workflow, agent.
 */

import { useEffect, useState } from 'react';
import {
  AnalyticsError,
  analyticsApi,
  count,
  money,
  moneyCompact,
  type MeteringAnalytics,
  type MeteringByModel,
  type RangeParams,
} from '../../../lib/analyticsApi';
import {
  ChartCard,
  DataTable,
  DownloadExcel,
  EmptyState,
  SectionHeading,
  StatTile,
  type Column,
} from '../../../components/analytics/ui';
import { HBarChart } from '../../../components/analytics/charts';
import { METRIC_COLOR } from '../../../components/analytics/palette';

const NANOS_PER_CENT = 10_000_000;

/** JSONB / bigint fields sometimes arrive as strings — coerce before math. */
function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function nanosToCents(nanos: unknown): number {
  return Math.round(asNumber(nanos) / NANOS_PER_CENT);
}

export function ModelsTab({ range }: { range: RangeParams }) {
  const [data, setData] = useState<MeteringAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void analyticsApi
      .metering(range)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof AnalyticsError
            ? err.message
            : 'Could not load model performance.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (loading && !data) {
    return (
      <p className="mt-10 text-center text-sm text-gray-500" role="status">
        Loading model performance…
      </p>
    );
  }

  if (error) {
    return (
      <div className="mt-10 rounded-xl border border-white/10 bg-ink-800/60 px-6 py-12 text-center">
        <p className="text-sm font-medium text-gray-200">Could not load models</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No metering data"
          body="AI usage events will appear here once customers run model-backed workflows."
        />
      </div>
    );
  }

  const totals = {
    eventCount: asNumber(data.totals?.eventCount),
    aiCostNanos: asNumber(data.totals?.aiCostNanos),
    computeUnits: asNumber(data.totals?.computeUnits),
    distinctOrgs: asNumber(data.totals?.distinctOrgs),
  };
  const totalCostCents = nanosToCents(totals.aiCostNanos);
  const models = (data.byModel ?? []).map((m) => ({
    ...m,
    eventCount: asNumber(m.eventCount),
    aiCostNanos: asNumber(m.aiCostNanos),
  }));
  const customers = (data.byCustomer ?? []).map((c) => ({
    ...c,
    eventCount: asNumber(c.eventCount),
    aiCostNanos: asNumber(c.aiCostNanos),
    computeUnits: asNumber(c.computeUnits),
    distinctJobs: asNumber(c.distinctJobs),
  }));
  const workflows = (data.byWorkflow ?? []).map((w) => ({
    ...w,
    eventCount: asNumber(w.eventCount),
    aiCostNanos: asNumber(w.aiCostNanos),
  }));
  const agents = (data.byAgent ?? []).map((a) => ({
    ...a,
    eventCount: asNumber(a.eventCount),
    aiCostNanos: asNumber(a.aiCostNanos),
  }));

  const modelColumns: Column<MeteringByModel>[] = [
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <span className="font-medium text-white">
          {r.model}
          <span className="ml-2 text-xs text-gray-500">{r.provider}</span>
        </span>
      ),
    },
    {
      key: 'events',
      header: 'Events',
      align: 'right',
      render: (r) => count(r.eventCount),
    },
    {
      key: 'cost',
      header: 'AI cost',
      align: 'right',
      render: (r) => money(nanosToCents(r.aiCostNanos)),
    },
    {
      key: 'share',
      header: 'Share',
      align: 'right',
      render: (r) =>
        totalCostCents > 0
          ? `${((nanosToCents(r.aiCostNanos) / totalCostCents) * 100).toFixed(1)}%`
          : '—',
    },
  ];

  const topModels = [...models]
    .sort((a, b) => b.aiCostNanos - a.aiCostNanos)
    .slice(0, 8);

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          tone="headline"
          label="AI cost (period)"
          value={moneyCompact(totalCostCents)}
          footnote={money(totalCostCents)}
        />
        <StatTile
          label="Events"
          value={count(totals.eventCount)}
          footnote="Model-backed calls"
        />
        <StatTile
          label="Customers using AI"
          value={count(totals.distinctOrgs)}
          footnote="Distinct orgs in period"
        />
        <StatTile
          label="Compute units"
          value={count(Math.round(totals.computeUnits))}
          footnote="Metered units billed"
        />
      </div>

      <SectionHeading title="Cost by model" hint="Provider cost estimate from metering" />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Top models by cost"
          subtitle="Where inference spend concentrates."
          action={
            <DownloadExcel href={analyticsApi.exportUrl(range, 'models')} label="Excel" compact />
          }
        >
          {topModels.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No model usage yet.</p>
          ) : (
            <HBarChart
              ariaLabel="AI cost by model"
              color={METRIC_COLOR.mrr}
              items={topModels.map((m) => ({
                key: `${m.provider}/${m.model}`,
                label: m.model,
                sublabel: m.provider,
                value: nanosToCents(m.aiCostNanos),
                display: money(nanosToCents(m.aiCostNanos)),
              }))}
            />
          )}
        </ChartCard>

        <ChartCard title="All models" subtitle="Every provider/model pair in the period.">
          <DataTable
            columns={modelColumns}
            rows={models}
            rowKey={(r) => `${r.provider}:${r.model}`}
            maxHeight="18rem"
            empty="No model rows yet."
          />
        </ChartCard>
      </div>

      <SectionHeading title="Cost by customer" hint="Internal only" />
      <ChartCard
        title="AI spend by organization"
        subtitle="Estimated provider cost attributed to each org."
      >
        <DataTable
          columns={[
            {
              key: 'org',
              header: 'Organization',
              render: (r) => <span className="font-medium text-white">{r.orgName}</span>,
            },
            {
              key: 'events',
              header: 'Events',
              align: 'right',
              render: (r) => count(r.eventCount),
            },
            {
              key: 'jobs',
              header: 'Jobs',
              align: 'right',
              render: (r) => count(r.distinctJobs),
            },
            {
              key: 'units',
              header: 'Compute units',
              align: 'right',
              render: (r) => count(Math.round(r.computeUnits)),
            },
            {
              key: 'cost',
              header: 'AI cost',
              align: 'right',
              render: (r) => money(nanosToCents(r.aiCostNanos)),
            },
          ]}
          rows={customers}
          rowKey={(r) => r.orgId}
          maxHeight="22rem"
          empty="No customer AI usage yet."
        />
      </ChartCard>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="By workflow" subtitle="Cost rolled up by workflow id.">
          <DataTable
            columns={[
              {
                key: 'wf',
                header: 'Workflow',
                render: (r) => r.workflowId,
              },
              {
                key: 'events',
                header: 'Events',
                align: 'right',
                render: (r) => count(r.eventCount),
              },
              {
                key: 'cost',
                header: 'AI cost',
                align: 'right',
                render: (r) => money(nanosToCents(r.aiCostNanos)),
              },
            ]}
            rows={workflows}
            rowKey={(r) => r.workflowId}
            maxHeight="16rem"
            empty="No workflow usage yet."
          />
        </ChartCard>
        <ChartCard title="By agent" subtitle="Cost rolled up by agent type.">
          <DataTable
            columns={[
              {
                key: 'agent',
                header: 'Agent',
                render: (r) => r.agentType,
              },
              {
                key: 'events',
                header: 'Events',
                align: 'right',
                render: (r) => count(r.eventCount),
              },
              {
                key: 'cost',
                header: 'AI cost',
                align: 'right',
                render: (r) => money(nanosToCents(r.aiCostNanos)),
              },
            ]}
            rows={agents}
            rowKey={(r) => r.agentType}
            maxHeight="16rem"
            empty="No agent usage yet."
          />
        </ChartCard>
      </div>

      <SectionHeading title="Exports" />
      <div className="flex flex-wrap gap-3">
        <DownloadExcel href={analyticsApi.exportUrl(range, 'models')} label="Models workbook" />
        <DownloadExcel href={analyticsApi.exportUrl(range, 'all')} label="Full workbook" compact />
      </div>
    </>
  );
}
