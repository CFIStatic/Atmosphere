import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type JobSuggestion } from '../lib/api';
import { jobFilePath } from '../lib/jobFileAsk';
import { queueSuggestedAsk } from '../lib/suggestedWork';
import { SuggestionCard } from '../components/suggestions/SuggestionCard';
import { PanelSpinner } from '../components/AppShell';

/** The Suggested work queue: every open suggestion in the workspace, by job. */
export function SuggestedWorkPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<JobSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listSuggestions()
      .then((res) => {
        if (!cancelled) setItems(res.suggestions);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load suggested work.');
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byJob = useMemo(() => {
    const groups = new Map<string, { title: string; items: JobSuggestion[] }>();
    for (const s of items ?? []) {
      const g = groups.get(s.jobId) ?? { title: s.jobTitle ?? 'Job', items: [] };
      g.items.push(s);
      groups.set(s.jobId, g);
    }
    return [...groups.entries()];
  }, [items]);

  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="suggested-work-page">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Suggested work</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-600">
          Work Atmosphere thinks each job is ready for, based on what is on the file. Approve hands it to Chat;
          anything that saves or submits still waits for your OK.
        </p>
      </header>
      {items === null ? (
        <div className="flex justify-center py-16">
          <PanelSpinner label="Loading suggested work" />
        </div>
      ) : error ? (
        <p className="mt-6 text-sm text-red-700" role="alert">{error}</p>
      ) : !byJob.length ? (
        <p className="mt-6 rounded-xl border border-line bg-paper-50 px-4 py-6 text-sm text-ink-600" data-testid="suggested-work-empty">
          Nothing to suggest right now. New suggestions show up here when a job is ready for its next step.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          {byJob.map(([jobId, group]) => (
            <section key={jobId} aria-label={group.title} className="flex flex-col gap-2">
              <Link to={jobFilePath(jobId, { title: group.title })} className="text-sm font-semibold text-ink-900 hover:underline">
                {group.title}
              </Link>
              {group.items.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onApprove={async (sug, edited) => {
                    const res = await api.approveSuggestion(sug.id, edited);
                    queueSuggestedAsk(sug.jobId, res.prompt);
                    navigate(jobFilePath(sug.jobId, { title: group.title, ask: true }));
                  }}
                  onDismiss={async (sug) => {
                    await api.dismissSuggestion(sug.id);
                    setItems((prev) => (prev ?? []).filter((x) => x.id !== sug.id));
                  }}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
