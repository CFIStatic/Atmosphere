import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { ReadyPayload } from '../lib/types';
import { StatusPill } from '../components/ui';
import { ErrorLine, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';

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

  const checks = Object.entries(ready?.checks ?? {});

  return (
    <div>
      <PageHeader
        eyebrow="System & access"
        title="System status"
        subtitle="Backend readiness from the same BFF this site proxies. Hosting: Railway service Internal Growth Metrics, /api reverse-proxied to Atmosphere APIs."
        asOfValue={ready ? ready.time : undefined}
      />
      {error && <ErrorLine message={error} />}

      <Section title="Signed in as">
        <dl className="grid gap-x-10 gap-y-3 text-[13px] sm:grid-cols-3">
          <div className="border-b border-line pb-2">
            <dt className="eyebrow">Email</dt>
            <dd className="mt-1 text-ink-900">{user?.email ?? '—'}</dd>
          </div>
          <div className="border-b border-line pb-2">
            <dt className="eyebrow">Analytics scope</dt>
            <dd className="mt-1 text-ink-900">{access?.scope ?? 'none'}</dd>
          </div>
          <div className="border-b border-line pb-2">
            <dt className="eyebrow">Staff name</dt>
            <dd className="mt-1 text-ink-900">{access?.displayName ?? '—'}</dd>
          </div>
        </dl>
      </Section>

      <Section
        title="Backend"
        note={ready?.service}
        actions={
          <DownloadButton
            table="system-checks"
            label="backend readiness checks"
            disabled={!ready}
            sheets={() => [
              {
                name: 'Backend checks',
                columns: [
                  { header: 'Service' },
                  { header: 'Overall status' },
                  { header: 'Checked at', type: 'datetime' },
                  { header: 'Check' },
                  { header: 'OK' },
                  { header: 'Skipped' },
                  { header: 'Detail' },
                ],
                rows: checks.map(([name, check]) => [
                  ready?.service,
                  ready?.status,
                  ready?.time,
                  name,
                  check.ok,
                  check.skipped ?? false,
                  check.detail ?? null,
                ]),
              },
            ]}
          />
        }
      >
        {ready && (
          <>
            <div className="mb-3 flex items-center gap-3">
              <StatusPill status={ready.status} />
              <span className="text-[12px] text-ink-500">{ready.time}</span>
            </div>
            <div className="max-w-3xl overflow-x-auto">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th className="num">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map(([name, check]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className={`num ${check.ok ? 'text-success-600' : 'text-danger-600'}`}>
                        {check.ok ? 'ok' : (check.detail ?? 'failed')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
