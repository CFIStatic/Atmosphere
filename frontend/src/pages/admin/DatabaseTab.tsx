import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, AdminError } from '../../lib/adminApi';
import { AdminErrorState } from './AdminShell';
import { SpinnerIcon } from '../../components/icons';

export function DatabaseTab() {
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState('');
  const [orgId, setOrgId] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .databaseTables()
      .then(({ tables: list }) => {
        if (cancelled) return;
        setTables(list);
        setTable(list[0] ?? '');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof AdminError ? err.message : 'Failed to list tables');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!table) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.browseTable(table, {
        limit: 50,
        orgId: orgId.trim() || undefined,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Failed to browse table');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [table, orgId]);

  useEffect(() => {
    if (table) void load();
  }, [table, load]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows) {
      for (const k of Object.keys(row)) keys.add(k);
    }
    return [...keys].slice(0, 12);
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">Table</span>
          <select
            value={table}
            onChange={(e) => setTable(e.target.value)}
            className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white"
          >
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[240px] flex-1 text-sm">
          <span className="mb-1 block text-xs text-gray-500">Filter by org UUID (optional)</span>
          <input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="org_id"
            className="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-600"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
        >
          Reload
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Curated read-only browser — not a SQL console. Showing up to 50 of {total.toLocaleString()}{' '}
        rows.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <SpinnerIcon className="animate-spin" width={14} height={14} /> Loading rows…
        </div>
      )}
      {error && <AdminErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-800/80 text-gray-500">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-white/5 align-top hover:bg-white/5">
                  {columns.map((c) => (
                    <td key={c} className="max-w-[220px] truncate px-2 py-1.5 font-mono text-gray-300">
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="px-3 py-8 text-center text-gray-500">
                    No rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
