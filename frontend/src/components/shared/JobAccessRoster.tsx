import { useEffect, useState } from 'react';
import { api, type JobAccessPerson } from '../../lib/api';

/**
 * Everyone with a path into this job file — homeowners (progress shares) and
 * Field Capture crew. Last open + who granted, for the office on /job-progress.
 */

function when(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'Never';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function personLabel(person: JobAccessPerson): string {
  return person.name?.trim() || person.email || 'Someone';
}

function grantedLine(person: JobAccessPerson): string {
  const by = person.grantedByName || person.grantedByEmail;
  if (by) return `Granted by ${by}`;
  return 'Granted by office';
}

export function JobAccessRoster({ jobId }: { jobId: string }) {
  const [people, setPeople] = useState<JobAccessPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeople(null);
    setError(null);
    void (async () => {
      try {
        const res = await api.jobAccessRoster(jobId);
        if (!cancelled) setPeople(res.people);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load who has access.');
          setPeople([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <section className="rounded-xl glass-card p-5" data-testid="job-access-roster">
      <div>
        <h2 className="text-base font-semibold text-ink-900">Who has access</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Homeowners on job progress and people invited to Field Capture — last visit and who
          invited them.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {people === null ? (
        <p className="mt-3 text-xs text-ink-500">Loading…</p>
      ) : people.length === 0 ? (
        <p className="mt-3 text-xs text-ink-500">
          Nobody outside the office has access yet. Share job progress or invite Field Capture.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800">{personLabel(person)}</p>
                <p className="text-[11px] text-ink-500">
                  {person.email && person.name && person.email !== person.name.toLowerCase()
                    ? `${person.email} · `
                    : ''}
                  {person.accessType}
                  {' · '}
                  {grantedLine(person)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-ink-500">
                  Last access {when(person.lastAccessedAt).toLowerCase()}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    person.state === 'claimed' || person.state === 'live'
                      ? 'bg-success-50 text-success-600'
                      : 'bg-paper-200/60 text-ink-500'
                  }`}
                >
                  {person.kind === 'homeowner'
                    ? person.state === 'claimed'
                      ? 'account'
                      : 'invite'
                    : 'Field Capture'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
