import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  RUN_STATUS_LABELS,
  type AgentRunStatus,
  type AgentSummary,
  type AuditRun,
  type AuditStats,
} from '../lib/api';
import { RunDetail } from '../components/audit/RunDetail';
import {
  ACCENT_STYLES,
  StatusChip,
  formatDuration,
  formatNumber,
  formatRelative,
} from '../components/audit/shared';
import { ChevronRightIcon, RefreshIcon, SearchIcon, SpinnerIcon } from '../components/icons';

/**
 * The Audit tab: everything every agent has done for this organization.
 *
 * The page is built around one question — "show me what happened" — asked at
 * three widths. The tiles answer it for the org, the agent cards answer it per
 * agent, and the list plus trace answer it for a single run, step by step.
 *
 * Agents with no runs are listed anyway. An audit surface that hides the agents
 * that did nothing cannot be used to check that an agent did nothing, which is
 * usually the question being asked.
 */

const RANGES = [
  { key: '24h', label: 'Last 24 hours', hours: 24 },
  { key: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { key: '30d', label: 'Last 30 days', hours: 24 * 30 },
  { key: 'all', label: 'All time', hours: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const LIVE_REFRESH_MS = 8000;

function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'active' | 'bad';
}) {
  const valueTone =
    tone === 'active' ? 'text-brand-300' : tone === 'bad' ? 'text-rose-300' : 'text-white';
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function AgentCard({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const accent = ACCENT_STYLES[agent.accent] ?? ACCENT_STYLES.brand;
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      title={agent.blurb}
      className={`rounded-xl border p-3.5 text-left transition ${
        selected
          ? 'border-brand-500/50 bg-brand-600/10'
          : 'border-white/10 bg-ink-800/40 hover:border-white/20 hover:bg-ink-800/70'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`truncate text-sm font-semibold ${accent.text}`}>{agent.name}</span>
        {agent.active > 0 && (
          <span className="flex items-center gap-1 text-xs text-brand-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
            {agent.active}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
        {formatNumber(agent.total)}
        <span className="ml-1.5 text-xs font-normal text-gray-500">
          run{agent.total === 1 ? '' : 's'}
        </span>
      </p>
      <p className="mt-1 truncate text-xs text-gray-500">
        {agent.total === 0
          ? agent.intake === 'bridge'
            ? 'No runs recorded yet'
            : 'No runs recorded yet'
          : `${formatNumber(agent.steps)} steps · ${agent.failed} failed · ${formatRelative(agent.lastRunAt)}`}
      </p>
    </button>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: AuditRun;
  selected: boolean;
  onSelect: () => void;
}) {
  const accent = ACCENT_STYLES[run.agent.accent] ?? ACCENT_STYLES.brand;
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={selected}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
          selected ? 'bg-brand-600/15' : 'hover:bg-white/5'
        }`}
      >
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${accent.bg} ring-2 ${accent.ring}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-xs font-medium ${accent.text}`}>{run.agent.name}</span>
            <span className="truncate text-xs text-gray-600">
              {run.agentLabel ?? run.actorEmail ?? ''}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-gray-100">{run.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <StatusChip status={run.status} />
            <span>{run.stepCount} steps</span>
            {run.durationMs !== null && <span>· {formatDuration(run.durationMs)}</span>}
            <span>· {formatRelative(run.createdAt)}</span>
          </span>
        </span>
        <ChevronRightIcon width={16} height={16} className="mt-1 shrink-0 text-gray-600" />
      </button>
    </li>
  );
}

export function AuditPage() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [stats, setStats] = useState<AuditStats | null>(null);

  const [runs, setRuns] = useState<AuditRun[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AgentRunStatus | ''>('');
  const [range, setRange] = useState<RangeKey>('7d');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /** True once older pages have been loaded — see the live-refresh effect. */
  const pagedBack = useRef(false);

  // Typing should filter, but not once per keystroke against the database.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const from = useMemo(() => {
    const hours = RANGES.find((entry) => entry.key === range)?.hours;
    if (!hours) return undefined;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [range]);

  const loadRuns = useCallback(async () => {
    setListError(null);
    try {
      const data = await api.auditRuns({
        agent: agentFilter ?? undefined,
        status: statusFilter || undefined,
        q: debouncedSearch || undefined,
        from,
        limit: 25,
      });
      setRuns(data.runs);
      setCursor(data.nextCursor);
    } catch (err) {
      setRuns([]);
      setCursor(null);
      setListError(err instanceof Error ? err.message : 'Could not load the audit trail.');
    }
  }, [agentFilter, statusFilter, debouncedSearch, from]);

  const loadSummary = useCallback(async () => {
    const [agentResult, statsResult] = await Promise.allSettled([
      api.auditAgents(),
      api.auditStats(),
    ]);
    if (agentResult.status === 'fulfilled') setAgents(agentResult.value.agents);
    else setAgents([]);
    if (statsResult.status === 'fulfilled') setStats(statsResult.value.stats);
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setRuns(null);
    pagedBack.current = false;
    void loadRuns();
  }, [loadRuns]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    pagedBack.current = false;
    try {
      await Promise.all([loadSummary(), loadRuns()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadSummary, loadRuns]);

  // Keep the page current while work is in flight. A hidden tab is not worth
  // polling for — nobody is reading it, and the refresh on return is enough.
  //
  // Once the reader has paged back through history, the live tick stops
  // reloading the list: refetching the first page would silently throw away
  // every older page they had loaded. Totals keep updating either way, and the
  // explicit Refresh button still reloads everything.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadSummary();
      if (!pagedBack.current) void loadRuns();
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, loadSummary, loadRuns]);

  async function loadNextPage() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await api.auditRuns({
        agent: agentFilter ?? undefined,
        status: statusFilter || undefined,
        q: debouncedSearch || undefined,
        from,
        limit: 25,
        cursor,
      });
      setRuns((prev) => [...(prev ?? []), ...data.runs]);
      setCursor(data.nextCursor);
      pagedBack.current = true;
    } catch {
      /* the button stays; the reader can try again */
    } finally {
      setLoadingMore(false);
    }
  }

  const filtersActive = Boolean(agentFilter || statusFilter || debouncedSearch || range !== '7d');

  function clearFilters() {
    setAgentFilter(null);
    setStatusFilter('');
    setSearch('');
    setRange('7d');
  }

  return (
    <div className="cx-aurora min-h-screen">
      <div className="mx-auto max-w-[110rem] px-5 py-8 sm:px-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand-400">Audit</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white">
              Everything your agents have done
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Every run every agent performed for this organization, and the ordered steps that
              produced it. Steps are append-only — once recorded, a trace cannot be edited.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={live}
                onChange={(event) => setLive(event.target.checked)}
                className="h-3.5 w-3.5 accent-brand-500"
              />
              Live
            </label>
            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-gray-300 transition hover:bg-ink-700 disabled:opacity-60"
            >
              <RefreshIcon
                width={16}
                height={16}
                className={refreshing ? 'animate-spin' : undefined}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* Org totals */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Runs" value={stats ? formatNumber(stats.totalRuns) : '—'} hint="all time" />
          <StatTile
            label="In flight"
            value={stats ? formatNumber(stats.activeRuns) : '—'}
            tone={stats && stats.activeRuns > 0 ? 'active' : 'default'}
            hint="queued or running"
          />
          <StatTile
            label="Failed"
            value={stats ? formatNumber(stats.failedRuns) : '—'}
            tone={stats && stats.failedRuns > 0 ? 'bad' : 'default'}
            hint="needs a look"
          />
          <StatTile
            label="Steps recorded"
            value={stats ? formatNumber(stats.totalSteps) : '—'}
            hint="across every run"
          />
          <StatTile
            label="Last activity"
            value={stats ? formatRelative(stats.lastRunAt) : '—'}
            hint={stats ? `${formatNumber(stats.runs24h)} runs in 24h` : undefined}
          />
        </div>

        {/* Per-agent */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Agents</h2>
            {agentFilter && (
              <button
                onClick={() => setAgentFilter(null)}
                className="text-xs text-brand-300 hover:text-brand-200"
              >
                Show all agents
              </button>
            )}
          </div>
          {agents === null ? (
            <div className="mt-3 grid place-items-center py-8 text-brand-300">
              <SpinnerIcon className="animate-spin" width={20} height={20} />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.key}
                  agent={agent}
                  selected={agentFilter === agent.key}
                  onSelect={() =>
                    setAgentFilter((prev) => (prev === agent.key ? null : agent.key))
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <SearchIcon
              width={16}
              height={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search what an agent was asked to do…"
              aria-label="Search runs"
              className="w-full rounded-lg border border-white/10 bg-ink-800/60 py-2 pl-9 pr-3 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500/50 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as AgentRunStatus | '')}
            aria-label="Filter by status"
            className="rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-gray-200 focus:border-brand-500/50 focus:outline-none"
          >
            <option value="">Any status</option>
            {(Object.keys(RUN_STATUS_LABELS) as AgentRunStatus[]).map((status) => (
              <option key={status} value={status}>
                {RUN_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as RangeKey)}
            aria-label="Filter by time"
            className="rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-gray-200 focus:border-brand-500/50 focus:outline-none"
          >
            {RANGES.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-400 transition hover:bg-white/5 hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* List + trace */}
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          {/* min-w-0 on both panes: a grid item defaults to min-width:auto, so
              the widest unbreakable line in a trace would stretch its track and
              scroll the whole page sideways instead of being truncated. */}
          <section
            aria-label="Runs"
            className={`min-w-0 overflow-hidden rounded-xl border border-white/10 bg-ink-800/30 ${
              selectedId ? 'hidden xl:block' : ''
            }`}
          >
            {runs === null ? (
              <div className="grid place-items-center py-16 text-brand-300">
                <SpinnerIcon className="animate-spin" width={22} height={22} />
                <span className="sr-only">Loading runs…</span>
              </div>
            ) : listError ? (
              <p className="px-5 py-10 text-center text-sm text-rose-300">{listError}</p>
            ) : runs.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm text-gray-400">
                  {filtersActive ? 'No runs match these filters.' : 'No agent work recorded yet.'}
                </p>
                <p className="mt-1.5 text-xs text-gray-600">
                  {filtersActive
                    ? 'Try widening the time range.'
                    : 'As soon as an agent runs, every step it takes lands here.'}
                </p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {runs.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      selected={selectedId === run.id}
                      onSelect={() => setSelectedId(run.id)}
                    />
                  ))}
                </ul>
                {cursor && (
                  <button
                    onClick={() => void loadNextPage()}
                    disabled={loadingMore}
                    className="flex w-full items-center justify-center gap-2 border-t border-white/10 px-4 py-2.5 text-sm text-gray-400 transition hover:bg-white/5 disabled:opacity-60"
                  >
                    {loadingMore && <SpinnerIcon className="animate-spin" width={15} height={15} />}
                    Load older runs
                  </button>
                )}
              </>
            )}
          </section>

          <section
            aria-label="Run detail"
            className={`min-w-0 rounded-xl border border-white/10 bg-ink-800/30 p-5 ${
              selectedId ? '' : 'hidden xl:block'
            }`}
          >
            {selectedId ? (
              <RunDetail runId={selectedId} onClose={() => setSelectedId(null)} />
            ) : (
              <div className="grid h-full min-h-[18rem] place-items-center text-center">
                <div>
                  <p className="text-sm text-gray-400">Pick a run to see how it went.</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Every step is shown in order — as a timeline, or one step at a time.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
