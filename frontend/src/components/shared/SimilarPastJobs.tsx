import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SimilarJobMatch } from '../../lib/api';
import { jobFilePath } from '../../lib/jobFileAsk';

/**
 * "Show me how we did this last time" — past jobs ranked by trade, rooms,
 * work type, and analysis similarity. Links open the other job file.
 *
 * Office / org staff only. Mount only when the viewer is an org member
 * (SharedDashboard uses `!grantViewer`). Homeowners, guests, grant-only
 * accounts, and Field Capture invitees must not see this panel.
 */
function scoreLabel(score: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return `${pct}% match`;
}

export function SimilarPastJobs({ jobId }: { jobId: string }) {
  const [matches, setMatches] = useState<SimilarJobMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMatches(null);
    setError(null);
    void (async () => {
      try {
        const res = await api.similarPastJobs(jobId);
        if (!cancelled) setMatches(res.matches);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load similar jobs.');
          setMatches([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <section className="rounded-xl glass-card p-5" data-testid="similar-past-jobs">
      <div>
        <h2 className="text-base font-semibold text-ink-900">Similar jobs</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          How we did this last time — past jobs matched by trade, rooms, work type, and analysis.
          Open one to train a new tech on the playbook.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {matches === null ? (
        <p className="mt-3 text-xs text-ink-500">Looking for similar past jobs…</p>
      ) : matches.length === 0 ? (
        <p className="mt-3 text-xs text-ink-500">
          No close matches yet. As more jobs get filmed and analysed in this org, they will show
          up here for training.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {matches.map((match) => (
            <li
              key={match.jobId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  to={jobFilePath(match.jobId, {
                    title: match.title,
                    number: match.jobNumber,
                  })}
                  className="text-sm font-medium text-brand-700 hover:underline"
                  data-testid={`similar-job-link-${match.jobId}`}
                >
                  {match.jobNumber != null ? `#${match.jobNumber} · ` : ''}
                  {match.title}
                </Link>
                <p className="text-[11px] text-ink-500">
                  {match.reasons.length
                    ? match.reasons.join(' · ')
                    : match.workType
                      ? match.workType
                      : 'Related job'}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-paper-200/60 px-2 py-0.5 text-[10.5px] font-semibold text-ink-600">
                {scoreLabel(match.score)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
