/**
 * A/B experiment funnel for Atmosphere internal staff.
 */

import { useEffect, useState } from 'react';
import {
  analyticsApi,
  count,
  percent,
  type ExperimentStats,
  type RangeParams,
} from '../../lib/analyticsApi';
import { ChartCard, DataTable, EmptyState, type Column } from './ui';

type VariantRow = {
  experiment: string;
  status: string;
  variant: string;
  label: string;
  assignments: number;
  exposures: number;
  conversions: number;
  conversionRate: number | null;
};

export function ExperimentsSection({ range }: { range: RangeParams }) {
  const [experiments, setExperiments] = useState<ExperimentStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void analyticsApi
      .experiments(range)
      .then((payload) => {
        if (!cancelled) {
          setExperiments(payload.experiments);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setExperiments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, range.months]);

  if (error) {
    return (
      <EmptyState title="Experiments unavailable" body={error} />
    );
  }

  if (!experiments) {
    return (
      <EmptyState title="Loading experiments…" body="Pulling assignment and conversion totals." />
    );
  }

  if (experiments.length === 0) {
    return (
      <EmptyState
        title="No experiments yet"
        body="Seed or create rows in public.experiments, set status to running, then assign via useExperiment()."
      />
    );
  }

  const rows: VariantRow[] = experiments.flatMap((exp) =>
    exp.variants.map((v) => ({
      experiment: exp.name || exp.experimentKey,
      status: exp.status,
      variant: v.variantKey,
      label: v.label,
      assignments: v.assignments,
      exposures: v.exposures,
      conversions: v.conversions,
      conversionRate: v.exposures > 0 ? (v.conversions / v.exposures) * 100 : null,
    })),
  );

  const columns: Column<VariantRow>[] = [
    {
      key: 'experiment',
      header: 'Experiment',
      render: (row) => (
        <span>
          <span className="font-medium text-ink-900">{row.experiment}</span>
          <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-500">
            {row.status}
          </span>
        </span>
      ),
    },
    {
      key: 'variant',
      header: 'Variant',
      render: (row) => (
        <span>
          <span className="text-ink-900">{row.variant}</span>
          <span className="ml-1.5 text-xs text-ink-500">{row.label}</span>
        </span>
      ),
    },
    {
      key: 'assignments',
      header: 'Assigned',
      align: 'right',
      render: (row) => count(row.assignments),
    },
    {
      key: 'exposures',
      header: 'Exposures',
      align: 'right',
      render: (row) => count(row.exposures),
    },
    {
      key: 'conversions',
      header: 'Conversions',
      align: 'right',
      render: (row) => count(row.conversions),
    },
    {
      key: 'rate',
      header: 'Conv. rate',
      align: 'right',
      render: (row) => percent(row.conversionRate),
    },
  ];

  return (
    <ChartCard
      title="A/B experiments"
      subtitle="Sticky per-user assignment · Atmosphere staff only"
    >
      <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.experiment}:${r.variant}`} />
    </ChartCard>
  );
}
