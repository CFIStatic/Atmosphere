import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { SafetyIncident } from '../lib/types';
import { dateTime } from '../lib/format';
import { EmptyState, SectionHeading, StatTile, StatusPill } from '../components/ui';

export function SafetyAlertsPage() {
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [counts, setCounts] = useState({ open: 0, criticalOpen: 0 });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'open' | 'all'>('open');

  async function refresh() {
    const payload = await api.safetyStaffIncidents({ status });
    setIncidents(payload.incidents);
    setCounts(payload.counts);
  }

  useEffect(() => {
    let cancelled = false;
    refresh().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load safety alerts');
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function ack(id: string) {
    setError(null);
    try {
      await api.ackSafetyStaffIncident(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not acknowledge');
    }
  }

  async function dismiss(id: string) {
    setError(null);
    try {
      await api.dismissSafetyStaffIncident(id, { reason: 'False positive / reviewed' });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not dismiss');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Safety alerts</h1>
      <p className="mt-1 text-sm text-ink-500">
        Near-real-time Field Capture emergency flags (fall, violence, threats, medical
        distress) plus silent panic / wellness (long no-motion while alone).
        Atmosphere never auto-dials 911 — authorities escalation is an org policy
        flag only. See docs/safety-alerts.md and docs/wellness-check.md.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Open" value={String(counts.open)} />
        <StatTile label="Critical open" value={String(counts.criticalOpen)} />
        <StatTile label="Showing" value={String(incidents.length)} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm ${status === 'open' ? 'bg-paper-200' : 'text-ink-600'}`}
          onClick={() => setStatus('open')}
        >
          Open
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm ${status === 'all' ? 'bg-paper-200' : 'text-ink-600'}`}
          onClick={() => setStatus('all')}
        >
          All
        </button>
      </div>

      <SectionHeading title="Incidents" hint="Ack confirms operators saw it; dismiss marks a false positive." />

      {incidents.length === 0 ? (
        <EmptyState title="No safety incidents" body="Open alerts from Field Capture will show here." />
      ) : (
        <ul className="mt-4 space-y-3">
          {incidents.map((incident) => (
            <li
              key={incident.id}
              className="rounded-lg border border-line bg-paper-50 p-4"
              data-testid="safety-incident-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={incident.severity} />
                    <StatusPill status={incident.status} />
                    <span className="text-xs uppercase tracking-wide text-ink-500">
                      {incident.category.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-1 font-medium text-ink-900">{incident.title}</p>
                  <p className="mt-1 text-sm text-ink-600">{incident.description}</p>
                  <p className="mt-2 text-xs text-ink-500">
                    {dateTime(incident.createdAt)}
                    {incident.jobId ? ` · job ${incident.jobId.slice(0, 8)}…` : ''}
                    {incident.clipTimestampSeconds != null
                      ? ` · ${incident.clipTimestampSeconds}s`
                      : ''}
                    {incident.locationLabel ? ` · ${incident.locationLabel}` : ''}
                    {` · ${incident.recommendedAction}`}
                    {` · conf ${(incident.confidence * 100).toFixed(0)}%`}
                  </p>
                </div>
                {incident.status === 'open' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
                      onClick={() => void ack(incident.id)}
                    >
                      Ack
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-line px-3 py-1.5 text-sm"
                      onClick={() => void dismiss(incident.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
