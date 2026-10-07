import { useEffect, useMemo, useState } from 'react';
import { api, defaultRange } from '../lib/api';
import type { ExperimentStats } from '../lib/types';
import { count, percent } from '../lib/format';
import { StatusPill } from '../components/ui';
import { ErrorLine, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';

const conversionRate = (v: { exposures: number; conversions: number }) =>
  v.exposures ? (v.conversions / v.exposures) * 100 : null;

function experimentsSheet(name: string, experiments: ExperimentStats[]): ExportSheet {
  return {
    name,
    columns: [
      { header: 'Experiment' },
      { header: 'Experiment key' },
      { header: 'Status' },
      { header: 'Variant' },
      { header: 'Variant key' },
      { header: 'Weight', type: 'number' },
      { header: 'Assigned', type: 'integer' },
      { header: 'Exposed', type: 'integer' },
      { header: 'Converted', type: 'integer' },
      { header: 'Conversion rate', type: 'percent' },
      { header: 'Events', type: 'integer' },
    ],
    rows: experiments.flatMap((e) =>
      e.variants.map((v) => [
        e.name,
        e.experimentKey,
        e.status,
        v.label,
        v.variantKey,
        v.weight,
        v.assignments,
        v.exposures,
        v.conversions,
        conversionRate(v),
        v.events,
      ]),
    ),
  };
}

export function ExperimentsPage() {
  const range = useMemo(() => defaultRange(), []);
  const [experiments, setExperiments] = useState<ExperimentStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .experiments(range)
      .then((res) => {
        if (!cancelled) setExperiments(res.experiments);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load experiments');
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (!experiments && !error) return <Loading label="Loading experiments" />;
  const list = experiments ?? [];

  return (
    <div>
      <PageHeader eyebrow="Growth & revenue" title="Experiments" subtitle="A/B assignments, exposures, and conversions." />
      {error && <ErrorLine message={error} />}
      <Section
        title={`${count(list.length)} tests`}
        note="Conversion rate = converted ÷ exposed"
        actions={
          <DownloadButton
            table="experiments"
            label="all experiments"
            disabled={list.length === 0}
            sheets={() => [experimentsSheet('Experiments', list)]}
          />
        }
      >
        {list.length === 0 && <p className="py-6 text-center text-[13px] text-ink-500">No experiments yet.</p>}
        <div className="space-y-8">
          {list.map((experiment) => (
            <article key={experiment.experimentKey}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-[14.5px] font-semibold text-ink-900">{experiment.name}</h3>
                <StatusPill status={experiment.status} />
                <span className="ml-auto">
                  <DownloadButton
                    table={`experiment-${experiment.experimentKey}`}
                    label={`${experiment.name} variants`}
                    sheets={() => [experimentsSheet(experiment.name, [experiment])]}
                  />
                </span>
              </div>
              {experiment.description && <p className="mt-1 text-[12.5px] text-ink-600">{experiment.description}</p>}
              <div className="mt-3 overflow-x-auto">
                <table className="report-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Variant</th>
                      <th className="num">Assigned</th>
                      <th className="num">Exposed</th>
                      <th className="num">Converted</th>
                      <th className="num">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiment.variants.map((variant) => (
                      <tr key={variant.variantKey}>
                        <td className="font-medium text-ink-900">{variant.label}</td>
                        <td className="num">{count(variant.assignments)}</td>
                        <td className="num">{count(variant.exposures)}</td>
                        <td className="num">{count(variant.conversions)}</td>
                        <td className="num">{percent(conversionRate(variant))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}
