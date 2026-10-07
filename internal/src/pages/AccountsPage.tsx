import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOverview } from '../hooks/useOverview';
import { count, dateTime, hours, money } from '../lib/format';
import { filterAccounts, sortAccounts, type AccountSort } from '../lib/search';
import { StatusPill } from '../components/ui';
import { ErrorLine, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { centsToUsd } from '../lib/excel';

const SORTS = [
  ['mrr', 'MRR'],
  ['usage', 'Usage'],
  ['recent', 'Newest'],
  ['name', 'Name'],
] as const;

export function AccountsPage() {
  const { data, error, loading, reload } = useOverview();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AccountSort>('mrr');

  const rows = useMemo(() => {
    return sortAccounts(filterAccounts(data?.accounts ?? [], query), sort);
  }, [data?.accounts, query, sort]);

  if (loading && !data) return <Loading label="Loading organizations" />;

  return (
    <div>
      <PageHeader
        eyebrow="Growth & revenue"
        title="Organizations"
        subtitle="Every organization in Atmosphere. Internal staff only: this is the identifying view."
        asOfValue={data?.generatedAt ?? null}
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      <Section
        title={`${count(rows.length)} organizations`}
        note={query ? `Filtered by “${query.trim()}”` : 'All organizations'}
        actions={
          <DownloadButton
            table="organizations"
            label="organizations"
            disabled={rows.length === 0}
            sheets={() => [
              {
                name: 'Organizations',
                columns: [
                  { header: 'Organization' },
                  { header: 'Org id' },
                  { header: 'Status' },
                  { header: 'Plan' },
                  { header: 'Plan code' },
                  { header: 'Billing' },
                  { header: 'MRR, USD', type: 'usd' },
                  { header: 'ARR, USD', type: 'usd' },
                  { header: 'Collected in period, USD', type: 'usd' },
                  { header: 'Members', type: 'integer' },
                  { header: 'Seats', type: 'integer' },
                  { header: 'Hours', type: 'number' },
                  { header: 'Top tool' },
                  { header: 'Created', type: 'date' },
                  { header: 'Last active', type: 'datetime' },
                ],
                rows: rows.map((row) => [
                  row.orgName,
                  row.orgId,
                  row.status,
                  row.planName,
                  row.planCode,
                  row.billingInterval,
                  centsToUsd(row.mrrCents),
                  centsToUsd(row.arrCents),
                  centsToUsd(row.revenueInRangeCents),
                  row.members,
                  row.seats,
                  row.activeHours,
                  row.topFeature,
                  row.createdAt,
                  row.lastActiveAt,
                ]),
              },
            ]}
          />
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search name, plan, or tool…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="field max-w-sm"
            aria-label="Search organizations"
          />
          <div className="flex items-center gap-1" role="group" aria-label="Sort by">
            <span className="mr-1 text-[11.5px] text-ink-500">Sort</span>
            {SORTS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
                className={`btn-quiet ${sort === key ? 'border-ink-900 bg-ink-900 text-paper-0 hover:text-paper-0' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="report-table min-w-[820px]">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Plan</th>
                <th className="num">MRR</th>
                <th className="num">Seats</th>
                <th className="num">Hours</th>
                <th>Top tool</th>
                <th className="num">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orgId}>
                  <td>
                    <Link to={`/accounts/${row.orgId}`} className="font-medium text-ink-900 hover:text-brand-600 hover:underline">
                      {row.orgName}
                    </Link>
                    <span className="ml-2">
                      <StatusPill status={row.status} />
                    </span>
                  </td>
                  <td className="text-ink-600">
                    {row.planName}
                    <span className="ml-1 text-[11.5px] text-ink-500">{row.billingInterval}</span>
                  </td>
                  <td className="num">{money(row.mrrCents)}</td>
                  <td className="num">
                    {count(row.members)}/{count(row.seats)}
                  </td>
                  <td className="num">{hours(row.activeHours)}</td>
                  <td className="text-ink-600">{row.topFeature ?? '—'}</td>
                  <td className="num whitespace-nowrap text-ink-600">{dateTime(row.lastActiveAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-500">
                    No organizations match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
