import { useEffect, useMemo, useState } from 'react';
import { api, defaultRange } from '../lib/api';
import type { ExperimentStats } from '../lib/types';
import { count, percent } from '../lib/format';
import { SectionHeading, StatusPill } from '../components/ui';

export function ExperimentsPage() {
  const range = useMemo(() => defaultRange(), []);
  const [experiments, setExperiments] = useState<ExperimentStats[]>([]);
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

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
      <p className="mt-1 text-sm text-ink-500">A/B assignments, exposures, and conversions.</p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}
      <SectionHeading title={`${count(experiments.length)} tests`} />
      <div className="grid gap-4">
        {experiments.map((experiment) => (
          <article key={experiment.experimentKey} className="rounded-xl border border-line bg-paper-0 p-5">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">{experiment.name}</h2>
              <StatusPill status={experiment.status} />
            </div>
            {experiment.description && (
              <p className="mt-1 text-sm text-ink-500">{experiment.description}</p>
            )}
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-2">Variant</th>
                  <th className="py-2 text-right">Assigned</th>
                  <th className="py-2 text-right">Exposed</th>
                  <th className="py-2 text-right">Converted</th>
                  <th className="py-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {experiment.variants.map((variant) => (
                  <tr key={variant.variantKey} className="border-t border-line">
                    <td className="py-2">{variant.label}</td>
                    <td className="py-2 text-right font-mono">{count(variant.assignments)}</td>
                    <td className="py-2 text-right font-mono">{count(variant.exposures)}</td>
                    <td className="py-2 text-right font-mono">{count(variant.conversions)}</td>
                    <td className="py-2 text-right font-mono">
                      {percent(variant.exposures ? (variant.conversions / variant.exposures) * 100 : null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </div>
  );
}
