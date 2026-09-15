import { useCallback, useEffect, useState } from 'react';
import { api, type JobAccessPerson } from '../../lib/api';
import { TrashIcon } from '../icons';

/**
 * Everyone with a path into this job file — homeowners (progress shares) and
 * Field Capture crew. Last open + who granted, for the office on /job-progress.
 * Org members only (parent hides this for homeowner viewers). Trash revokes.
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
  if (person.displayName?.trim()) return person.displayName.trim();
  if (person.kind === 'homeowner' || person.role === 'homeowner') return 'Homeowner';
  const name = person.name?.trim() || person.email || 'Someone';
  const title = person.displayLabel?.trim() || person.accessType?.trim();
  if (title && name && !name.toLowerCase().includes(title.toLowerCase())) {
    return `${name} — ${title}`;
  }
  return name;
}

function grantedLine(person: JobAccessPerson): string {
  const by = person.grantedByName || person.grantedByEmail;
  if (by) return `Granted by ${by}`;
  return 'Granted by office';
}

/** Subtitle: email · role · Granted by … — skip role when already in the title. */
function personSubtitle(person: JobAccessPerson, title: string): string {
  const parts: string[] = [];
  const email = person.email?.trim();
  if (email) parts.push(email);

  const role = (person.accessType || person.displayLabel || '').trim();
  if (role && !title.toLowerCase().includes(role.toLowerCase())) {
    parts.push(role);
  }

  parts.push(grantedLine(person));
  return parts.join(' · ');
}

function statusBadgeLabel(person: JobAccessPerson): string {
  if (person.kind === 'homeowner') {
    return person.state === 'claimed' ? 'account' : 'invite';
  }
  return 'Field Capture';
}

export function JobAccessRoster({ jobId }: { jobId: string }) {
  const [people, setPeople] = useState<JobAccessPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await api.jobAccessRoster(jobId);
    setPeople(res.people);
  }, [jobId]);

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

  async function revoke(person: JobAccessPerson) {
    setRevokingId(person.id);
    setError(null);
    try {
      await api.revokeJobAccess(jobId, person.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke access.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="rounded-xl glass-card p-5" data-testid="job-access-roster" data-job-section="access">
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
          {people.map((person) => {
            const title = personLabel(person);
            const subtitle = personSubtitle(person, title);
            return (
              <li
                key={person.id}
                data-testid="job-access-roster-row"
                className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">{title}</p>
                  <p className="truncate text-[11px] text-ink-500">{subtitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  <div className="flex flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-[11px] text-ink-500">
                      Last access {when(person.lastAccessedAt).toLowerCase()}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                        person.state === 'claimed' || person.state === 'live'
                          ? 'bg-success-50 text-success-600'
                          : 'bg-paper-200/60 text-ink-500'
                      }`}
                    >
                      {statusBadgeLabel(person)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void revoke(person)}
                    disabled={revokingId === person.id}
                    aria-label={`Revoke access for ${title}`}
                    className="rounded-lg p-1.5 text-ink-400 transition hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50"
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
