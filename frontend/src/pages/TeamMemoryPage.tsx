import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  formatMinutes,
  timeAgo,
  type AgentMemory,
  type MemoryEvent,
} from '../lib/api';
import { AppShell, PageHeader, PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { MemoryFeed } from '../components/MemoryFeed';
import { SpinnerIcon, ChevronLeftIcon } from '../components/icons';

/**
 * The team, and what each person has actually done.
 *
 * Selecting someone opens their trail through the memory — every action of
 * theirs, in order, across every job.
 */

function AgentCard({ agent, onOpen }: { agent: AgentMemory; onOpen: () => void }) {
  const name = agent.fullName || agent.email || agent.userId;

  return (
    <button
      onClick={onOpen}
      className="rounded-xl glass-card p-5 text-left transition hover:border-brand-400/40 hover:bg-paper-200"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600/30 text-sm font-semibold uppercase text-brand-200">
          {name.slice(0, 2)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{name}</p>
          <p className="truncate text-xs text-ink-500">
            {ROLE_LABELS[agent.role] ?? agent.role} · {WORK_TYPE_LABELS[agent.workType] ?? agent.workType}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {[
          ['Actions', agent.eventCount.toLocaleString()],
          ['Jobs', String(agent.jobsTouched)],
          ['Open tasks', String(agent.openTasks)],
          ['Logged', formatMinutes(agent.minutesLogged)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-500">{label}</dt>
            <dd className="font-semibold text-ink-800">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-ink-500">Last active {timeAgo(agent.lastActiveAt)}</p>
    </button>
  );
}

function AgentDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [agent, setAgent] = useState<AgentMemory | null>(null);
  const [events, setEvents] = useState<MemoryEvent[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMemoryAgent(userId)
      .then((res) => {
        if (cancelled) return;
        setAgent(res.agent);
        setEvents(res.events);
        setCursor(res.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load that person.');
        setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function loadMore() {
    if (cursor === null) return;
    setLoadingMore(true);
    try {
      const res = await api.getMemoryAgent(userId, cursor);
      setEvents((prev) => [...(prev ?? []), ...res.events]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  const name = agent?.fullName || agent?.email || 'This person';

  return (
    <>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-600 transition hover:text-ink-800"
      >
        <ChevronLeftIcon width={16} height={16} />
        Everyone
      </button>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {agent && (
        <>
          <PageHeader
            eyebrow={ROLE_LABELS[agent.role] ?? agent.role}
            title={name}
            description={`Everything ${name} has done, across every job.`}
          />

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['Actions', agent.eventCount.toLocaleString()],
              ['Jobs touched', String(agent.jobsTouched)],
              ['Open tasks', String(agent.openTasks)],
              ['Tasks done', String(agent.tasksCompleted)],
              ['Work logged', formatMinutes(agent.minutesLogged)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl glass-card px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
                <p className="mt-1 text-xl font-semibold text-ink-900">{value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {events === null ? (
        <PanelSpinner label="Loading their history" />
      ) : (
        <>
          <MemoryFeed events={events} emptyLabel={`Nothing recorded for ${name} yet.`} />
          {cursor !== null && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-lg glass-card px-5 py-2.5 text-sm font-medium text-ink-800 transition hover:bg-paper-200 disabled:opacity-60"
              >
                {loadingMore && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                {loadingMore ? 'Loading…' : 'Load earlier'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

export function TeamMemoryPage() {
  const [agents, setAgents] = useState<AgentMemory[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMemoryAgents()
      .then(({ agents }) => setAgents(agents))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load the team.');
        setAgents([]);
      });
  }, []);

  return (
    <AppShell>
      {selected ? (
        <AgentDetail userId={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <PageHeader
            title="Team"
            description="Everyone linked to your organization, and what the record says each of them has done."
          />

          {error && (
            <div className="mb-4">
              <ErrorNote message={error} />
            </div>
          )}

          {agents === null ? (
            <PanelSpinner label="Loading the team" />
          ) : agents.length === 0 ? (
            <EmptyState title="No linked accounts yet." hint="Share your join code to bring teammates on." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <AgentCard key={agent.userId} agent={agent} onOpen={() => setSelected(agent.userId)} />
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
