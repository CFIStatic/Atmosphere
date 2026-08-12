import { useCallback, useEffect, useState } from 'react';
import { adminApi, AdminError, formatWhen, type AuditEntry } from '../../lib/adminApi';
import { AdminErrorState } from './AdminShell';
import { SpinnerIcon } from '../../components/icons';

export function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.listAudit({ limit: 100 });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <SpinnerIcon className="animate-spin" width={14} height={14} /> Loading audit log…
      </div>
    );
  }
  if (error) return <AdminErrorState message={error} onRetry={() => void load()} />;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">{total.toLocaleString()} audited actions</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5"
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-800/80 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="whitespace-nowrap px-3 py-2 text-gray-400">{formatWhen(e.createdAt)}</td>
                <td className="px-3 py-2 text-gray-300">{e.actorEmail ?? e.actorUserId}</td>
                <td className="px-3 py-2 font-mono text-xs text-amber-200/90">{e.action}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-500">
                  {[e.targetType, e.targetId].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="max-w-xs truncate px-3 py-2 font-mono text-[11px] text-gray-500">
                  {Object.keys(e.detail || {}).length ? JSON.stringify(e.detail) : '—'}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                  No support actions logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
