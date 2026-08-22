import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { ReadyPayload } from '../lib/types';
import { SectionHeading, StatusPill } from '../components/ui';

export function SystemPage() {
  const { user, access } = useAuth();
  const [ready, setReady] = useState<ReadyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .ready()
      .then((payload) => {
        if (!cancelled) setReady(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not reach API');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">System</h1>
      <p className="mt-1 text-sm text-ink-500">
        Backend readiness from the same BFF this site proxies. Hosting: Railway service
        Internal Growth Metrics, /api reverse-proxied to Atmosphere APIs.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      <SectionHeading title="Signed in as" />
      <dl className="grid gap-3 rounded-xl border border-line bg-paper-0 p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-500">Email</dt>
          <dd className="mt-1 font-mono">{user?.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-500">Analytics scope</dt>
          <dd className="mt-1">{access?.scope ?? 'none'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-500">Staff name</dt>
          <dd className="mt-1">{access?.displayName ?? '—'}</dd>
        </div>
      </dl>

      <SectionHeading title="Backend" hint={ready?.service} />
      {ready && (
        <div className="rounded-xl border border-line bg-paper-0 p-5">
          <div className="flex items-center gap-3">
            <StatusPill status={ready.status} />
            <span className="text-sm text-ink-500">{ready.time}</span>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(ready.checks ?? {}).map(([name, check]) => (
              <li key={name} className="flex items-center justify-between rounded-lg bg-paper-50 px-3 py-2 text-sm">
                <span>{name}</span>
                <span className={check.ok ? 'text-success-600' : 'text-danger-600'}>
                  {check.ok ? 'ok' : check.detail ?? 'failed'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
