import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type PlaybookStatus,
  type TradePlaybook,
} from '../lib/api';
import { PanelSpinner, ErrorNote } from '../components/AppShell';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

const STATUS_LABEL: Record<PlaybookStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

/**
 * Org-scoped trade playbook library — reusable checklist / skill cards
 * generated from completed job analysis (or created manually).
 */
export function PlaybooksLibraryPage() {
  useFeatureTimer('playbooks_library');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [playbooks, setPlaybooks] = useState<TradePlaybook[]>([]);
  const [detail, setDetail] = useState<TradePlaybook | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PlaybookStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listPlaybooks({
        status: statusFilter,
        q: q.trim() || undefined,
      });
      setPlaybooks(res.playbooks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load playbooks.');
    } finally {
      setLoaded(true);
    }
  }, [statusFilter, q]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void api
      .getPlaybook(selectedId)
      .then((res) => {
        if (!cancelled) setDetail(res.playbook);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo(() => {
    if (detail && detail.id === selectedId) return detail;
    return playbooks.find((p) => p.id === selectedId) ?? null;
  }, [detail, playbooks, selectedId]);

  function openPlaybook(id: string) {
    setParams({ id }, { replace: false });
  }

  function clearSelection() {
    setParams({}, { replace: false });
  }

  async function publish(id: string) {
    setBusyId(id);
    try {
      await api.publishPlaybook(id);
      await load();
      if (selectedId === id) {
        const res = await api.getPlaybook(id);
        setDetail(res.playbook);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not publish.');
    } finally {
      setBusyId(null);
    }
  }

  async function archive(id: string) {
    setBusyId(id);
    try {
      await api.archivePlaybook(id);
      await load();
      if (selectedId === id) {
        const res = await api.getPlaybook(id);
        setDetail(res.playbook);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive.');
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded && !playbooks.length) {
    return (
      <div className="flex justify-center py-16">
        <PanelSpinner label="Loading playbooks" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl" data-testid="playbooks-library">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Playbooks</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-600">
            Reusable checklist and skill cards for your trades — saved from completed job
            analysis (for example roofing tear-off → dry-in). Foundation for a training corpus.
          </p>
        </div>
        <Link
          to="/settings?section=organization"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          Organization settings
        </Link>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-ink-500">
          Status
          <select
            className="ml-2 rounded-lg border border-line bg-paper-0 px-2.5 py-1.5 text-sm text-ink-800"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PlaybookStatus | 'all')}
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <input
          type="search"
          placeholder="Search title or trade"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[12rem] flex-1 rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-sm text-ink-800"
        />
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      {!playbooks.length ? (
        <div className="mt-8 rounded-xl border border-dashed border-line bg-paper-0/60 px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink-800">No playbooks yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            Open a job file with completed analysis and choose <strong>Save as playbook</strong>.
            Atmosphere turns the day&apos;s work into an ordered checklist your crew can reuse.
          </p>
          <Link
            to="/verifier-library"
            className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline"
          >
            Go to Dashboard
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="playbooks-grid">
            {playbooks.map((pb) => {
              const active = pb.id === selectedId;
              return (
                <li key={pb.id}>
                  <button
                    type="button"
                    onClick={() => openPlaybook(pb.id)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      active
                        ? 'border-brand-400 bg-brand-50/40 shadow-card'
                        : 'glass-card hover:border-brand-300'
                    }`}
                    data-testid={`playbook-card-${pb.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-sm font-semibold text-ink-900">{pb.title}</h2>
                      <span className="shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600">
                        {STATUS_LABEL[pb.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {[pb.trade?.replace(/_/g, ' '), `${pb.stepCount} step${pb.stepCount === 1 ? '' : 's'}`, pb.sourceKind === 'job_analysis' ? 'from job' : pb.sourceKind]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {pb.summary && (
                      <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-ink-600">
                        {pb.summary}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <aside className="rounded-xl glass-card p-4 lg:sticky lg:top-20 lg:self-start" data-testid="playbook-detail">
            {!selected ? (
              <p className="text-sm text-ink-500">Select a playbook to read its checklist.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-ink-900">{selected.title}</h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {STATUS_LABEL[selected.status]}
                      {selected.trade ? ` · ${selected.trade.replace(/_/g, ' ')}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-xs text-ink-500 hover:text-ink-800"
                  >
                    Close
                  </button>
                </div>
                {selected.summary && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-700">{selected.summary}</p>
                )}
                <ol className="mt-4 space-y-2" data-testid="playbook-steps">
                  {(selected.steps ?? []).map((step) => (
                    <li
                      key={step.id}
                      className="rounded-lg border border-line/80 bg-paper-0/80 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper-200 text-[10px] font-bold text-ink-600">
                          {step.position + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-900">{step.title}</p>
                          {step.instruction && (
                            <p className="mt-0.5 text-[12px] leading-snug text-ink-600">
                              {step.instruction}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-400">
                            {[step.skillKey, step.evidenceHint ? 'evidence' : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.status !== 'published' && (
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void publish(selected.id)}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-brand-700 disabled:opacity-50"
                    >
                      Publish
                    </button>
                  )}
                  {selected.status !== 'archived' && (
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void archive(selected.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100 disabled:opacity-50"
                    >
                      Archive
                    </button>
                  )}
                  {selected.sourceJobId && (
                    <Link
                      to={`/jobs/${selected.sourceJobId}`}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                    >
                      Source job
                    </Link>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
