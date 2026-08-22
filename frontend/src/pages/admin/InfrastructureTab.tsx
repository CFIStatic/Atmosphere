import { useCallback, useEffect, useState } from 'react';
import { adminApi, AdminError, formatWhen, type InfraSnapshot } from '../../lib/adminApi';
import { AdminErrorState } from './AdminShell';
import { SpinnerIcon } from '../../components/icons';

export function InfrastructureTab() {
  const [data, setData] = useState<InfraSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminApi.infrastructure());
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Failed to load infrastructure');
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
        <SpinnerIcon className="animate-spin" width={14} height={14} /> Checking backend…
      </div>
    );
  }
  if (error) return <AdminErrorState message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-400">
          Environment <span className="text-white">{data.environment}</span> · as of{' '}
          {formatWhen(data.time)}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white">Dependency checks</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(data.checks).map(([name, check]) => (
            <div
              key={name}
              className="rounded-xl border border-white/10 bg-ink-800/40 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-200">{name}</p>
                <StatusPill ok={check.ok} skipped={check.skipped} />
              </div>
              {check.detail && <p className="mt-1 text-xs text-gray-500">{check.detail}</p>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white">Row counts</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(data.counts).map(([table, count]) => (
            <div key={table} className="rounded-xl border border-white/10 px-4 py-3">
              <p className="text-xs text-gray-500">{table}</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {count === null ? '—' : count.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white">Config flags</h2>
        <ul className="space-y-1 text-sm text-gray-300">
          {Object.entries(data.configFlags).map(([key, on]) => (
            <li key={key} className="flex items-center gap-2">
              <span className={on ? 'text-emerald-400' : 'text-gray-600'}>{on ? '●' : '○'}</span>
              {key}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatusPill({ ok, skipped }: { ok: boolean; skipped?: boolean }) {
  if (skipped) {
    return (
      <span className="rounded bg-gray-500/20 px-1.5 py-0.5 text-[10px] uppercase text-gray-300">
        skipped
      </span>
    );
  }
  return (
    <span
      className={[
        'rounded px-1.5 py-0.5 text-[10px] uppercase',
        ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200',
      ].join(' ')}
    >
      {ok ? 'ok' : 'fail'}
    </span>
  );
}
