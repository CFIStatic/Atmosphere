import { useOverview } from '../hooks/useOverview';
import { count, dateTime, hours, percent } from '../lib/format';
import { SectionHeading } from '../components/ui';

export function UsagePage() {
  const { data, error, loading } = useOverview();
  if (loading && !data) return <p className="text-ink-500">Loading usage…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
      <p className="mt-1 text-sm text-ink-500">
        Foreground time in every instrumented tool. Same numbers as /analytics, hosted here for staff.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}
      <SectionHeading title="Features" hint="Ranked by hours" />
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Tool</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3 text-right">Hours</th>
              <th className="px-4 py-3 text-right">Share</th>
              <th className="px-4 py-3 text-right">Users</th>
              <th className="px-4 py-3 text-right">Orgs</th>
              <th className="px-4 py-3 text-right">AI</th>
              <th className="px-4 py-3 text-right">Last used</th>
            </tr>
          </thead>
          <tbody>
            {(data?.features ?? []).map((row) => (
              <tr key={row.featureKey} className="border-t border-line">
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3 text-ink-600">{row.area}</td>
                <td className="px-4 py-3 text-right font-mono">{hours(row.activeHours)}</td>
                <td className="px-4 py-3 text-right font-mono">{percent(row.sharePct)}</td>
                <td className="px-4 py-3 text-right font-mono">{count(row.users)}</td>
                <td className="px-4 py-3 text-right font-mono">{count(row.orgs)}</td>
                <td className="px-4 py-3 text-right font-mono">{count(row.aiRequests)}</td>
                <td className="px-4 py-3 text-right text-ink-500">{dateTime(row.lastUsedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
