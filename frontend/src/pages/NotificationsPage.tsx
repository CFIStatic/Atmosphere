import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type JobSuggestion } from '../lib/api';
import { jobFilePath } from '../lib/jobFileAsk';
import { queueSuggestedAsk } from '../lib/suggestedWork';
import { SuggestionCard } from '../components/suggestions/SuggestionCard';
import { PanelSpinner } from '../components/AppShell';

/**
 * Notifications: one page, a stack of sections. Suggested work is the only
 * section today; a new kind of notification is a new entry in `sections`.
 * Work itself always runs in the job's Chat.
 */
export function NotificationsPage() {
  const suggested = useSuggestedWork();
  const sections: Array<{ id: string; title: string; blurb: string; count: number | null; body: ReactNode }> = [
    {
      id: 'suggested-work',
      title: 'Suggested work',
      blurb: 'Work each job is ready for, based on what is on the file. Approve opens the job’s Chat; anything that saves or submits still waits for your OK.',
      count: suggested.items?.length ?? null,
      body: <SuggestedWorkSection state={suggested} />,
    },
  ];
  const total = sections.reduce((n, s) => n + (s.count ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="notifications-page">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Notifications</h1>
        <p className="mt-1 text-sm text-ink-600">{total ? `${total} open` : 'You’re all caught up.'}</p>
      </header>
      <div className="mt-5 flex flex-col gap-8">
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={`notif-${s.id}`} data-testid={`notifications-section-${s.id}`}>
            <div className="flex items-center gap-2">
              <h2 id={`notif-${s.id}`} className="text-base font-semibold text-ink-900">{s.title}</h2>
              {s.count ? (
                <span className="rounded-full bg-brand-600 px-2 text-[11px] font-semibold leading-[18px] text-white">{s.count}</span>
              ) : null}
            </div>
            <p className="mt-0.5 max-w-xl text-[13px] text-ink-600">{s.blurb}</p>
            <div className="mt-3">{s.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

interface SuggestedState {
  items: JobSuggestion[] | null;
  error: string | null;
  remove: (id: string) => void;
}

function useSuggestedWork(): SuggestedState {
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
  return { items, error, remove: (id) => setItems((prev) => (prev ?? []).filter((x) => x.id !== id)) };
}

function SuggestedWorkSection({ state }: { state: SuggestedState }) {
  const navigate = useNavigate();
  const byJob = useMemo(() => {
    const groups = new Map<string, { title: string; items: JobSuggestion[] }>();
    for (const s of state.items ?? []) {
      const g = groups.get(s.jobId) ?? { title: s.jobTitle ?? 'Job', items: [] };
      g.items.push(s);
      groups.set(s.jobId, g);
    }
    return [...groups.entries()];
  }, [state.items]);

  if (state.items === null) {
    return (
      <div className="flex justify-center py-10">
        <PanelSpinner label="Loading suggested work" />
      </div>
    );
  }
  if (state.error) return <p className="text-sm text-red-700" role="alert">{state.error}</p>;
  if (!byJob.length) {
    return (
      <p className="rounded-xl border border-line bg-paper-50 px-4 py-6 text-sm text-ink-600" data-testid="suggested-work-empty">
        Nothing to suggest right now. New suggestions show up here when a job is ready for its next step.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {byJob.map(([jobId, group]) => (
        <div key={jobId} className="flex flex-col gap-2">
          <Link to={jobFilePath(jobId, { title: group.title })} className="text-sm font-semibold text-ink-900 hover:underline">
            {group.title} <span aria-hidden>→</span>
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
                state.remove(sug.id);
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
