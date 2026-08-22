import { useEffect, useMemo, useState } from 'react';
import { api, defaultRange } from '../lib/api';
import type { MeteringPayload } from '../lib/types';
import { count, nanosToMoney } from '../lib/format';
import { SectionHeading, StatTile } from '../components/ui';

export function MeteringPage() {
  const range = useMemo(() => defaultRange(), []);
  const [data, setData] = useState<MeteringPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .metering(range)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load metering');
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const totals = data?.totals;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Metering</h1>
      <p className="mt-1 text-sm text-ink-500">
        AI cost versus compute — internal only. Customers never see token-level cost.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}
      {totals && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="AI cost" value={nanosToMoney(totals.aiCostNanos)} />
          <StatTile label="Events" value={count(totals.eventCount)} />
          <StatTile label="Compute units" value={count(totals.computeUnits)} />
          <StatTile label="Orgs" value={count(totals.distinctOrgs)} />
        </div>
      )}
      <SectionHeading title="By customer" />
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3 text-right">Events</th>
              <th className="px-4 py-3 text-right">Jobs</th>
              <th className="px-4 py-3 text-right">AI cost</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byCustomer ?? []).map((row) => (
              <tr key={row.orgId} className="border-t border-line">
                <td className="px-4 py-3 font-medium">{row.orgName}</td>
                <td className="px-4 py-3 text-right font-mono">{count(row.eventCount)}</td>
                <td className="px-4 py-3 text-right font-mono">{count(row.distinctJobs)}</td>
                <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.aiCostNanos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionHeading title="By model" />
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3 text-right">Events</th>
              <th className="px-4 py-3 text-right">AI cost</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byModel ?? []).map((row) => (
              <tr key={`${row.provider}-${row.model}`} className="border-t border-line">
                <td className="px-4 py-3">{row.provider}</td>
                <td className="px-4 py-3 font-mono text-sm">{row.model}</td>
                <td className="px-4 py-3 text-right font-mono">{count(row.eventCount)}</td>
                <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.aiCostNanos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
