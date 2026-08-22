import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOverview } from '../hooks/useOverview';
import { count, dateTime, hours, money } from '../lib/format';
import { filterAccounts, sortAccounts, type AccountSort } from '../lib/search';
import { api } from '../lib/api';
import { SectionHeading, StatusPill } from '../components/ui';

export function AccountsPage() {
  const { data, error, loading } = useOverview();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AccountSort>('mrr');

  const rows = useMemo(() => {
    return sortAccounts(filterAccounts(data?.accounts ?? [], query), sort);
  }, [data?.accounts, query, sort]);

  if (loading && !data) return <p className="text-ink-500">Loading accounts…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
      <p className="mt-1 text-sm text-ink-500">
        Every organization in Atmosphere. Internal staff only — this is the identifying view.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search name, plan, or tool…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full max-w-sm rounded-lg border border-line-strong bg-paper-0 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <div className="flex gap-1">
          {([
            ['mrr', 'MRR'],
            ['usage', 'Usage'],
            ['recent', 'Newest'],
            ['name', 'Name'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`rounded-md px-2 py-1 text-xs ${
                sort === key ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-paper-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {data && (
          <a
            href={api.exportUrl({ from: new Date(data.range.from), to: new Date(data.range.to), months: 12 }, 'accounts')}
            className="ml-auto text-sm text-brand-600 hover:underline"
          >
            Export Excel
          </a>
        )}
      </div>

      <SectionHeading title={`${count(rows.length)} organizations`} />
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3 text-right">MRR</th>
              <th className="px-4 py-3 text-right">Seats</th>
              <th className="px-4 py-3 text-right">Hours</th>
              <th className="px-4 py-3">Top tool</th>
              <th className="px-4 py-3 text-right">Last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.orgId} className="border-t border-line hover:bg-paper-50">
                <td className="px-4 py-3">
                  <Link to={`/accounts/${row.orgId}`} className="font-medium hover:text-brand-600">
                    {row.orgName}
                  </Link>
                  <span className="ml-2">
                    <StatusPill status={row.status} />
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-600">
                  {row.planName}
                  <span className="ml-1 text-xs text-ink-500">{row.billingInterval}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono">{money(row.mrrCents)}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {count(row.members)}/{count(row.seats)}
                </td>
                <td className="px-4 py-3 text-right font-mono">{hours(row.activeHours)}</td>
                <td className="px-4 py-3 text-ink-600">{row.topFeature ?? '—'}</td>
                <td className="px-4 py-3 text-right text-ink-500">{dateTime(row.lastActiveAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-500">
                  No organizations match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
