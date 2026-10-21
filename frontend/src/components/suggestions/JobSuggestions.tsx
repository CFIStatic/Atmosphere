import { useEffect, useState } from 'react';
import { api, type JobSuggestion } from '../../lib/api';
import { queueSuggestedAsk } from '../../lib/suggestedWork';
import { SuggestionCard } from './SuggestionCard';

/**
 * Suggested work on the job file. Office members only: the parent renders
 * this only for the workspace's own staff, and the server refuses anyone
 * else. Renders nothing when there is nothing to suggest.
 */
export function JobSuggestions({ jobId, onHandoff }: { jobId: string; onHandoff: () => void }) {
  // Keyed by job so another job's suggestions never show while this one loads.
  const [loaded, setLoaded] = useState<{ jobId: string; items: JobSuggestion[] } | null>(null);
  const items = loaded && loaded.jobId === jobId ? loaded.items : [];
  const setItems = (update: (prev: JobSuggestion[]) => JobSuggestion[]) =>
    setLoaded((prev) => (prev && prev.jobId === jobId ? { jobId, items: update(prev.items) } : prev));

  useEffect(() => {
    let cancelled = false;
    api
      .listSuggestions(jobId)
      .then((res) => {
        if (!cancelled) setLoaded({ jobId, items: res.suggestions });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ jobId, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!items.length) return null;

  return (
    <section aria-label="Suggested work" className="flex flex-col gap-2" data-testid="job-suggestions">
      {items.slice(0, 3).map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          onApprove={async (sug, edited) => {
            const res = await api.approveSuggestion(sug.id, edited);
            setItems((prev) => prev.filter((x) => x.id !== sug.id));
            onHandoff();
            queueSuggestedAsk(jobId, res.prompt);
          }}
          onDismiss={async (sug) => {
            await api.dismissSuggestion(sug.id);
            setItems((prev) => prev.filter((x) => x.id !== sug.id));
          }}
        />
      ))}
    </section>
  );
}
