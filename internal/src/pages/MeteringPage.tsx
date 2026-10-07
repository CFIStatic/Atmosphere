import { useEffect, useMemo, useState } from 'react';
import { api, defaultRange } from '../lib/api';
import type { MeteringPayload } from '../lib/types';
import { count, nanosToMoney } from '../lib/format';
import { ErrorLine, KpiStrip, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { nanosToUsd } from '../lib/excel';

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

  if (!data && !error) return <Loading label="Loading metering" />;
  const totals = data?.totals;
  const byCustomer = data?.byCustomer ?? [];
  const byModel = data?.byModel ?? [];
  const byWorkflow = data?.byWorkflow ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="AI cost & usage"
        title="Metering"
        subtitle="Provider AI cost from the token ledger (token_usage_events), trailing twelve months. Internal only: customers never see token-level cost."
      />
      {error && <ErrorLine message={error} />}
      {totals && (
        <KpiStrip
          download={{ table: 'metering-totals', label: 'metering totals' }}
          items={[
            { label: 'AI cost', unit: 'USD, trailing 12 months', value: nanosToMoney(totals.aiCostNanos), raw: nanosToUsd(totals.aiCostNanos), rawType: 'usd' },
            { label: 'Events', unit: 'metered events', value: count(totals.eventCount), raw: totals.eventCount, rawType: 'integer' },
            { label: 'Compute units', unit: '1 unit = $0.01 of AI cost', value: count(Math.round(totals.computeUnits)), raw: totals.computeUnits, rawType: 'number' },
            { label: 'Orgs', unit: 'with metered usage', value: count(totals.distinctOrgs), raw: totals.distinctOrgs, rawType: 'integer' },
          ]}
        />
      )}

      <Section
        title="By customer"
        note={`${count(byCustomer.length)} organizations`}
        actions={
          <DownloadButton
            table="metering-by-customer"
            label="metering by customer"
            disabled={byCustomer.length === 0}
            sheets={() => [
              {
                name: 'By customer',
                columns: [
                  { header: 'Organization' },
                  { header: 'Org id' },
                  { header: 'Events', type: 'integer' },
                  { header: 'Jobs', type: 'integer' },
                  { header: 'Compute units', type: 'integer' },
                  { header: 'AI cost, USD', type: 'usd', format: '"$"#,##0.0000' },
                ],
                rows: byCustomer.map((r) => [r.orgName, r.orgId, r.eventCount, r.distinctJobs, r.computeUnits, nanosToUsd(r.aiCostNanos)]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[560px]">
            <thead>
              <tr>
                <th>Organization</th>
                <th className="num">Events</th>
                <th className="num">Jobs</th>
                <th className="num">AI cost</th>
              </tr>
            </thead>
            <tbody>
              {byCustomer.map((row) => (
                <tr key={row.orgId}>
                  <td className="font-medium text-ink-900">
                    {row.orgName}
                    {row.internal && <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-caution-600">internal</span>}
                  </td>
                  <td className="num">{count(row.eventCount)}</td>
                  <td className="num">{count(row.distinctJobs)}</td>
                  <td className="num">{nanosToMoney(row.aiCostNanos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="By model"
        note={`${count(byModel.length)} models`}
        actions={
          <DownloadButton
            table="metering-by-model"
            label="metering by model"
            disabled={byModel.length === 0}
            sheets={() => [
              {
                name: 'By model',
                columns: [
                  { header: 'Provider' },
                  { header: 'Model' },
                  { header: 'Events', type: 'integer' },
                  { header: 'AI cost, USD', type: 'usd', format: '"$"#,##0.0000' },
                ],
                rows: byModel.map((r) => [r.provider, r.model, r.eventCount, nanosToUsd(r.aiCostNanos)]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[560px]">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th className="num">Events</th>
                <th className="num">AI cost</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => (
                <tr key={`${row.provider}-${row.model}`}>
                  <td>{row.provider}</td>
                  <td className="text-ink-700">{row.model}</td>
                  <td className="num">{count(row.eventCount)}</td>
                  <td className="num">{nanosToMoney(row.aiCostNanos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="By feature"
        note={`${count(byWorkflow.length)} features`}
        actions={
          <DownloadButton
            table="metering-by-feature"
            label="metering by feature"
            disabled={byWorkflow.length === 0}
            sheets={() => [
              {
                name: 'By feature',
                columns: [
                  { header: 'Feature' },
                  { header: 'Events', type: 'integer' },
                  { header: 'AI cost, USD', type: 'usd', format: '"$"#,##0.0000' },
                ],
                rows: byWorkflow.map((r) => [r.workflowId, r.eventCount, nanosToUsd(r.aiCostNanos)]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[420px]">
            <thead>
              <tr>
                <th>Feature</th>
                <th className="num">Events</th>
                <th className="num">AI cost</th>
              </tr>
            </thead>
            <tbody>
              {byWorkflow.map((row) => (
                <tr key={row.workflowId}>
                  <td>{row.workflowId}</td>
                  <td className="num">{count(row.eventCount)}</td>
                  <td className="num">{nanosToMoney(row.aiCostNanos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
