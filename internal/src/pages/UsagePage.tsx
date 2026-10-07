import { useOverview } from '../hooks/useOverview';
import { count, dateTime, hours, percent } from '../lib/format';
import { ErrorLine, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';

export function UsagePage() {
  const { data, error, loading, reload } = useOverview();
  if (loading && !data) return <Loading label="Loading usage" />;
  const features = data?.features ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Product"
        title="Feature usage"
        subtitle="Foreground time in every instrumented tool. Same numbers as /analytics, hosted here for staff."
        asOfValue={data?.generatedAt ?? null}
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}
      <Section
        title="Features"
        note="Ranked by hours"
        actions={
          <DownloadButton
            table="feature-usage"
            label="feature usage"
            disabled={features.length === 0}
            sheets={() => [
              {
                name: 'Feature usage',
                columns: [
                  { header: 'Tool' },
                  { header: 'Feature key' },
                  { header: 'Area' },
                  { header: 'Hours', type: 'number' },
                  { header: 'Share', type: 'percent' },
                  { header: 'Sessions', type: 'integer' },
                  { header: 'Users', type: 'integer' },
                  { header: 'Orgs', type: 'integer' },
                  { header: 'AI requests', type: 'integer' },
                  { header: 'Last used', type: 'datetime' },
                ],
                rows: features.map((row) => [
                  row.label,
                  row.featureKey,
                  row.area,
                  row.activeHours,
                  row.sharePct,
                  row.sessions,
                  row.users,
                  row.orgs,
                  row.aiRequests,
                  row.lastUsedAt,
                ]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[760px]">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Area</th>
                <th className="num">Hours</th>
                <th className="num">Share</th>
                <th className="num">Users</th>
                <th className="num">Orgs</th>
                <th className="num">AI</th>
                <th className="num">Last used</th>
              </tr>
            </thead>
            <tbody>
              {features.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-ink-500">
                    No feature usage recorded yet.
                  </td>
                </tr>
              ) : (
                features.map((row) => (
                  <tr key={row.featureKey}>
                    <td className="font-medium text-ink-900">{row.label}</td>
                    <td className="text-ink-600">{row.area}</td>
                    <td className="num">{hours(row.activeHours)}</td>
                    <td className="num">{percent(row.sharePct)}</td>
                    <td className="num">{count(row.users)}</td>
                    <td className="num">{count(row.orgs)}</td>
                    <td className="num">{count(row.aiRequests)}</td>
                    <td className="num whitespace-nowrap text-ink-600">{dateTime(row.lastUsedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
