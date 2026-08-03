import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  formatMinutes,
  type MemoryEvent,
  type MemoryStats,
  type OrgMember,
} from '../lib/api';
import { AppShell, PageHeader, PanelSpinner, ErrorNote } from '../components/AppShell';
import { MemoryFeed } from '../components/MemoryFeed';
import { SpinnerIcon, DownloadIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

/**
 * The organization's running memory.
 *
 * Paging appends rather than replaces, and the cursor is the `seq` of the last
 * row on screen — so scrolling back through the record never skips or repeats an
 * entry, even while new ones are arriving at the top.
 */

const FAMILIES = [
  { value: '', label: 'Everything' },
  { value: 'job', label: 'Jobs' },
  { value: 'task', label: 'Tasks' },
  { value: 'work_log', label: 'Work logs' },
  { value: 'assignment', label: 'Crew' },
  { value: 'auth', label: 'Sign-ins' },
];

const inputClass =
  'w-full rounded-lg border border-line glass-field px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400';

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl glass-card px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function MemoryPage() {
  useFeatureTimer('memory');
  const [events, setEvents] = useState<MemoryEvent[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [family, setFamily] = useState('');
  const [actorId, setActorId] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const { events, nextCursor } = await api.getMemory({
        eventType: family || undefined,
        actorId: actorId || undefined,
        search: search || undefined,
        limit: 50,
      });
      setEvents(events);
      setCursor(nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the memory.');
      setEvents([]);
    }
  }, [family, actorId, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    api.getMemoryStats().then(setStats).catch(() => setStats(null));
    api
      .getMembers()
      .then(({ members }) => setMembers(members))
      .catch(() => setMembers([]));
  }, []);

  async function loadMore() {
    if (cursor === null) return;
    setLoadingMore(true);
    try {
      const { events: more, nextCursor } = await api.getMemory({
        eventType: family || undefined,
        actorId: actorId || undefined,
        search: search || undefined,
        before: cursor,
        limit: 50,
      });
      setEvents((prev) => [...(prev ?? []), ...more]);
      setCursor(nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Memory"
        description="Every action anyone has taken, in order. Entries are written by the database itself and cannot be edited or removed — including by us."
        action={
          <a
            href={api.memoryExportUrl()}
            className="flex items-center gap-2 rounded-lg border border-line bg-paper-200 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-300"
          >
            <DownloadIcon width={17} height={17} />
            Export
          </a>
        }
      />

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Recorded" value={stats.totalEvents.toLocaleString()} hint="all time" />
          <StatTile label="Team" value={String(stats.agents)} hint={`${stats.activeToday} active today`} />
          <StatTile label="Work logged" value={formatMinutes(stats.minutesLogged)} />
          <StatTile
            label="Busiest"
            value={
              Object.entries(stats.byType).sort((a, b) => b[1] - a[1])[0]?.[0]?.split('.')[1]?.replace(/_/g, ' ') ??
              '—'
            }
            hint="recent activity"
          />
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-[auto_1fr_1fr]">
        <div className="flex flex-wrap gap-1.5">
          {FAMILIES.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setFamily(f.value);
                setEvents(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                family === f.value
                  ? 'bg-brand-600 text-ink-900'
                  : 'border border-line text-ink-600 hover:bg-paper-200 hover:text-ink-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={actorId}
          onChange={(e) => {
            setActorId(e.target.value);
            setEvents(null);
          }}
          aria-label="Filter by person"
          className={inputClass}
        >
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName || m.email}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the record…"
          aria-label="Search the memory"
          className={inputClass}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {events === null ? (
        <PanelSpinner label="Loading the memory" />
      ) : (
        <>
          <MemoryFeed
            events={events}
            emptyLabel={
              family || actorId || search
                ? 'Nothing in the record matches those filters.'
                : 'Nothing recorded yet. Open a job and it starts filling in.'
            }
          />

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
    </AppShell>
  );
}
