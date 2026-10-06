import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type {
  PlaybookDraft,
  PracticeRunDetail,
  PracticeStatus,
  PracticeSummaryPayload,
} from '../lib/types';
import { EmptyState, SectionHeading, StatTile, StatusPill } from '../components/ui';

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(v % 1 ? 1 : 0)}%`);
const usd = (v: number) => `$${v.toFixed(v > 0 && v < 1 ? 3 : 2)}`;

const DOT: Record<PracticeStatus, string> = {
  succeeded: 'bg-success-600',
  failed: 'bg-danger-600',
  needs_login: 'bg-caution-600',
  skipped: 'bg-line-strong',
  running: 'bg-ink-500',
};

const SIGN_IN_TEXT: Record<'one_page' | 'username_first' | 'open_first', string> = {
  one_page: 'Sign-in: one page',
  username_first: 'Sign-in: username, then password',
  open_first: 'Sign-in: click Sign in first',
};

const TERMS_TEXT: Record<string, string> = {
  allowed: 'Allowed',
  restricted: 'Human pace only',
  no_ban_found: 'No ban found',
  unverified: 'Unverified',
  flagged: 'Bans automation',
};

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [run, setRun] = useState<PracticeRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .computerPracticeRun(id)
      .then(setRun)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the run.'));
  }, [id]);
  return (
    <section
      className="mt-6 border-y border-line-strong py-4"
      data-testid="practice-run-detail"
      aria-label="Practice run"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-ink-900">{run?.label ?? 'Practice run'}</h3>
          {run ? (
            <p className="mt-1 text-[12px] text-ink-600">
              {run.date} · <StatusPill status={run.status} /> · {run.modelCalls} model calls ·{' '}
              {usd(run.costUsd)} · {run.durationSec ?? '—'}s
              {run.usedPlaybook ? ` · playbook v${run.playbookVersion}` : ''}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] font-semibold text-brand-600 hover:underline"
        >
          Close
        </button>
      </div>
      {error ? <p className="mt-3 text-[13px] text-danger-600">{error}</p> : null}
      {run?.failureReason ? (
        <p className="mt-3 text-[13px] text-danger-600">{run.failureReason}</p>
      ) : null}
      {run ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-[12px] font-semibold text-ink-700">Steps</h4>
            <ol className="mt-2 space-y-1 text-[12.5px]">
              {run.steps.map((s) => (
                <li
                  key={s.index}
                  className={s.ok ? 'text-ink-800' : 'font-semibold text-danger-600'}
                >
                  {s.index + 1}. {s.label}
                  <span className="text-ink-500"> · {s.via}</span>
                  {s.note ? <span className="text-ink-500"> · {s.note}</span> : null}
                </li>
              ))}
              {run.steps.length === 0 ? <li className="text-ink-500">No steps recorded.</li> : null}
            </ol>
            <h4 className="mt-4 text-[12px] font-semibold text-ink-700">Model routing</h4>
            <ul className="mt-2 space-y-1 text-[12px] text-ink-700">
              {run.routes.map((r, i) => (
                <li key={i}>
                  Step {r.step}: {r.route} ({r.model}) — {r.reason}
                </li>
              ))}
              {run.routes.length === 0 ? (
                <li className="text-ink-500">No model calls (playbook replay or skipped).</li>
              ) : null}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {run.screens.map((s) => (
              <figure key={s.index}>
                <img src={s.src} alt={s.label} className="w-full border border-line" />
                <figcaption className="mt-1 text-[11px] text-ink-600">{s.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DraftCard({ draft, onDone }: { draft: PlaybookDraft; onDone: () => void }) {
  const [removed, setRemoved] = useState<number[]>([]);
  const [taskType, setTaskType] = useState(draft.taskType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="border-t border-line py-3" data-testid="playbook-draft">
      <p className="text-[13px] font-semibold text-ink-900">
        {draft.site} · {draft.source === 'handoff' ? 'From a handoff' : 'From a demonstration'} ·{' '}
        {draft.stepCount} steps
      </p>
      <label className="mt-2 block text-[11.5px] text-ink-700">
        Task type
        <input
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
          className="ml-2 border border-line px-1.5 py-0.5 text-[12px]"
        />
      </label>
      <ol className="mt-2 space-y-1 text-[12.5px]">
        {draft.steps.map((s) => (
          <li
            key={s.index}
            className={removed.includes(s.index) ? 'text-ink-400 line-through' : 'text-ink-800'}
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={!removed.includes(s.index)}
                onChange={(e) =>
                  setRemoved((r) =>
                    e.target.checked ? r.filter((x) => x !== s.index) : [...r, s.index],
                  )
                }
              />
              {s.index + 1}. {s.text}
            </label>
          </li>
        ))}
      </ol>
      {error ? <p className="mt-2 text-[12px] text-danger-600">{error}</p> : null}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(() => api.approvePlaybookDraft(draft.id, { taskType, removeSteps: removed }))
          }
          className="text-[12px] font-semibold text-success-600 hover:underline disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(() => api.rejectPlaybookDraft(draft.id))}
          className="text-[12px] font-semibold text-danger-600 hover:underline disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </article>
  );
}

/** Staff-only: Computer's daily practice results, playbooks, drafts and site coverage. */
export function ComputerPracticePage() {
  const [data, setData] = useState<PracticeSummaryPayload | null>(null);
  const [drafts, setDrafts] = useState<PlaybookDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    Promise.all([api.computerPractice(14), api.computerPlaybookDrafts('pending')])
      .then(([summary, d]) => {
        if (!alive) return;
        setData(summary);
        setDrafts(d.drafts);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load practice results.');
      });
    return () => {
      alive = false;
    };
  }, [reloads]);

  const runNow = async () => {
    setNotice(null);
    try {
      const r = await api.computerPracticeRunNow();
      setNotice(`Started ${r.tasks.length} practice tasks. Results appear as each one finishes.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start practice runs.');
    }
  };

  if (error) return <EmptyState title="Computer practice" body={error} />;
  if (!data) return <p className="text-[13px] text-ink-500">Loading…</p>;
  const t = data.totals;
  const coverage = data.coverage;
  return (
    <div data-testid="computer-practice-page">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-[24px] text-ink-900">Computer practice</h1>
          <p className="mt-1 text-[12.5px] text-ink-600">
            Daily read-only and stop-before-submit tasks on the demo org, last {data.days} days.{' '}
            {data.schedule.enabled
              ? `Runs daily at ${String(data.schedule.hourUtc).padStart(2, '0')}:00 UTC.`
              : 'The daily schedule is off.'}
            {data.orgConfigured ? '' : ' The practice org is not configured.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          className="border border-line-strong px-3 py-1 text-[12px] font-semibold text-ink-800 hover:border-brand-500"
        >
          Run all now
        </button>
      </div>
      {notice ? <p className="mt-2 text-[12.5px] text-ink-700">{notice}</p> : null}

      <div className="mt-6 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Success rate"
          value={pct(t.successRate)}
          footnote={`${t.succeeded} of ${t.attempted} attempted`}
        />
        <StatTile label="Needs login" value={String(t.needsLogin)} footnote="runs skipped" />
        <StatTile label="Failed" value={String(t.failed)} />
        <StatTile
          label="Playbook runs"
          value={String(t.playbookRuns)}
          footnote="replayed without guessing"
        />
        <StatTile label="Model calls" value={String(t.modelCalls)} />
        <StatTile
          label="AI cost (staff only)"
          value={usd(t.costUsd)}
          footnote={t.avgDurationSec != null ? `avg ${t.avgDurationSec}s per run` : undefined}
        />
      </div>

      <SectionHeading
        title="Tasks"
        hint="One dot per day: green succeeded, red failed, amber needs login"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" data-testid="practice-tasks">
          <thead>
            <tr className="text-left text-[11px] text-ink-600">
              <th className="py-1 pr-3 font-semibold">Task</th>
              <th className="py-1 pr-3 font-semibold">Success</th>
              <th className="py-1 pr-3 font-semibold">Last {data.days} days</th>
              <th className="py-1 font-semibold">Last result</th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((task) => (
              <tr key={task.key} className="border-t border-line align-top">
                <td className="py-1.5 pr-3">
                  <span className="text-ink-900">{task.label}</span>
                  <span className="block text-[11px] text-ink-500">
                    {task.mode === 'read_only' ? 'Read-only' : 'Stops before submit'}
                    {task.loginHost ? ` · needs a Login for ${task.loginHost}` : ' · public site'}
                  </span>
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{pct(task.successRate)}</td>
                <td className="py-1.5 pr-3">
                  <span className="flex gap-0.5">
                    {task.days.map((d) => (
                      <button
                        key={d.date}
                        type="button"
                        disabled={!d.runId}
                        title={`${d.date}: ${d.status ?? 'no run'}`}
                        onClick={() => d.runId && setOpenRun(d.runId)}
                        className={`h-2.5 w-2.5 rounded-full ${d.status ? DOT[d.status] : 'bg-line'}`}
                      />
                    ))}
                  </span>
                </td>
                <td className="py-1.5">
                  {task.lastStatus ? (
                    <StatusPill status={task.lastStatus} />
                  ) : (
                    <span className="text-ink-500">Not run yet</span>
                  )}
                  {task.lastFailure ? (
                    <span className="block max-w-md text-[11px] text-ink-600">
                      {task.lastFailure}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openRun ? <RunDetail id={openRun} onClose={() => setOpenRun(null)} /> : null}

      <SectionHeading
        title="Playbook drafts to review"
        hint="From Take control sessions and handoffs; typed values are never saved"
      />
      {drafts.length ? (
        drafts.map((d) => <DraftCard key={d.id} draft={d} onDone={load} />)
      ) : (
        <p className="text-[12.5px] text-ink-500">No drafts waiting.</p>
      )}

      <SectionHeading title="Playbooks" hint="Shared, PII-scrubbed steps by site and task" />
      {data.playbooks.length ? (
        <table className="w-full text-[12.5px]" data-testid="practice-playbooks">
          <tbody>
            {data.playbooks.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink-900">{p.site}</td>
                <td className="py-1.5 pr-3">{p.taskType}</td>
                <td className="py-1.5 pr-3">v{p.version}</td>
                <td className="py-1.5 pr-3">{p.steps} steps</td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {p.successCount + p.replaySuccessCount} successes · {p.failureCount} failures
                </td>
                <td className="py-1.5">
                  <StatusPill status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[12.5px] text-ink-500">
          No playbooks yet. They are saved after the first verified success.
        </p>
      )}

      {coverage ? (
        <>
          <SectionHeading
            title="Site coverage and terms"
            hint="Terms verdicts are staff-only. Sites whose terms ban automation are listed and practiced by the customer’s choice; Verisk sites are excluded"
          />
          <table className="w-full text-[12px]" data-testid="practice-coverage">
            <tbody>
              {coverage.sites.map((s) => (
                <tr key={s.id} className="border-t border-line align-top">
                  <td className="py-1 pr-3 text-ink-900">{s.name}</td>
                  <td className="py-1 pr-3 text-ink-600">{s.category}</td>
                  <td
                    className={`py-1 pr-3 ${s.terms === 'flagged' ? 'font-semibold text-danger-600' : 'text-ink-700'}`}
                  >
                    <a
                      href={s.termsUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={s.termsNote}
                      className="hover:underline"
                    >
                      {TERMS_TEXT[s.terms]}
                    </a>
                  </td>
                  <td className="py-1 pr-3 text-ink-600">{s.inPicker ? 'In picker' : 'Hidden'}</td>
                  <td className="py-1 pr-3 text-ink-600" title={s.signIn?.checked === 'blocked_probe' ? 'The page blocks automated browsers; steps from the site’s help pages' : undefined}>
                    {s.signIn ? `${SIGN_IN_TEXT[s.signIn.flow]}${s.signIn.checked === 'blocked_probe' ? ' (help pages)' : ''}` : '—'}
                  </td>
                  <td className="py-1 pr-3 text-ink-600">
                    {s.twoStep === 'likely' ? 'Code at sign-in' : ''}
                    {s.sso ? ' · SSO' : ''}
                  </td>
                  <td className="py-1 text-ink-600">
                    {s.practiceTasks.length
                      ? `${s.practiceTasks.length} practice task${s.practiceTasks.length > 1 ? 's' : ''}${s.needsTestLogin ? ' · needs a test Login' : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
              {coverage.excluded.map((e) => (
                <tr key={e.name} className="border-t border-line">
                  <td className="py-1 pr-3 text-ink-900">{e.name}</td>
                  <td className="py-1 pr-3 text-ink-600" colSpan={6}>
                    Excluded: {e.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
