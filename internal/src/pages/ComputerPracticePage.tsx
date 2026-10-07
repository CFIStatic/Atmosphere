import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type {
  PlaybookDraft,
  PracticeRunDetail,
  PracticeStatus,
  PracticeSummaryPayload,
} from '../lib/types';
import { EmptyState, SectionHeading, StatusPill } from '../components/ui';
import { KpiStrip, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';

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
  if (!data) return <Loading label="Loading practice results" />;
  const t = data.totals;
  const coverage = data.coverage;
  return (
    <div data-testid="computer-practice-page">
      <PageHeader
        eyebrow="AI cost & usage"
        title="Computer practice"
        subtitle={
          <>
            Daily read-only and stop-before-submit tasks on the demo org, last {data.days} days.{' '}
            {data.schedule.enabled
              ? `Runs daily at ${String(data.schedule.hourUtc).padStart(2, '0')}:00 UTC.`
              : 'The daily schedule is off.'}
            {data.orgConfigured ? '' : ' The practice org is not configured.'}
          </>
        }
        asOfValue={data.generatedAt}
        actions={
          <button type="button" onClick={() => void runNow()} className="btn">
            Run all now
          </button>
        }
      />
      {notice ? <p className="mt-3 text-[12.5px] text-ink-700">{notice}</p> : null}

      <KpiStrip
        download={{ table: 'computer-practice-totals', label: 'practice totals' }}
        caption={`Last ${data.days} days`}
        items={[
          {
            label: 'Success rate',
            unit: `${t.succeeded} of ${t.attempted} attempted`,
            value: pct(t.successRate),
            raw: t.successRate,
            rawType: 'percent',
          },
          { label: 'Needs login', unit: 'runs skipped', value: String(t.needsLogin), raw: t.needsLogin, rawType: 'integer' },
          { label: 'Failed', unit: 'runs', value: String(t.failed), raw: t.failed, rawType: 'integer' },
          { label: 'Playbook runs', unit: 'replayed without guessing', value: String(t.playbookRuns), raw: t.playbookRuns, rawType: 'integer' },
          { label: 'Model calls', unit: 'count', value: String(t.modelCalls), raw: t.modelCalls, rawType: 'integer' },
          {
            label: 'AI cost (staff only)',
            unit: t.avgDurationSec != null ? `avg ${t.avgDurationSec}s per run` : 'USD',
            value: usd(t.costUsd),
            raw: t.costUsd,
            rawType: 'usd',
          },
        ]}
      />

      <Section
        title="Tasks"
        note="One dot per day: green succeeded, red failed, amber needs login"
        actions={
          <DownloadButton
            table="computer-practice-tasks"
            label="practice tasks"
            disabled={data.tasks.length === 0}
            sheets={() => [
              {
                name: 'Tasks',
                columns: [
                  { header: 'Task' },
                  { header: 'Task key' },
                  { header: 'Site' },
                  { header: 'Mode' },
                  { header: 'Needs a Login for' },
                  { header: 'Runs', type: 'integer' },
                  { header: 'Attempted', type: 'integer' },
                  { header: 'Succeeded', type: 'integer' },
                  { header: 'Failed', type: 'integer' },
                  { header: 'Needs login', type: 'integer' },
                  { header: 'Success rate', type: 'percent' },
                  { header: 'Last result' },
                  { header: 'Last run', type: 'datetime' },
                  { header: 'Last failure' },
                ],
                rows: data.tasks.map((task) => [
                  task.label,
                  task.key,
                  task.site,
                  task.mode === 'read_only' ? 'Read-only' : 'Stops before submit',
                  task.loginHost,
                  task.runs,
                  task.attempted,
                  task.succeeded,
                  task.failed,
                  task.needsLogin,
                  task.successRate,
                  task.lastStatus,
                  task.lastRunAt,
                  task.lastFailure,
                ]),
              },
              {
                name: 'Daily results',
                columns: [
                  { header: 'Task' },
                  { header: 'Date', type: 'date' },
                  { header: 'Result' },
                  { header: 'Run id' },
                ],
                rows: data.tasks.flatMap((task) => task.days.map((d) => [task.label, d.date, d.status ?? 'no run', d.runId])),
              },
              {
                name: 'Recent runs',
                columns: [
                  { header: 'Date', type: 'date' },
                  { header: 'Task key' },
                  { header: 'Site' },
                  { header: 'Mode' },
                  { header: 'Status' },
                  { header: 'Failed step', type: 'integer' },
                  { header: 'Failure reason' },
                  { header: 'Used playbook' },
                  { header: 'Playbook version', type: 'integer' },
                  { header: 'Model calls', type: 'integer' },
                  { header: 'Cost, USD', type: 'usd', format: '"$"#,##0.000' },
                  { header: 'Duration, seconds', type: 'integer' },
                  { header: 'Started', type: 'datetime' },
                  { header: 'Finished', type: 'datetime' },
                  { header: 'Run id' },
                ],
                rows: data.recent.map((r) => [
                  r.date,
                  r.taskKey,
                  r.site,
                  r.mode,
                  r.status,
                  r.failedStep,
                  r.failureReason,
                  r.usedPlaybook,
                  r.playbookVersion,
                  r.modelCalls,
                  r.costUsd,
                  r.durationSec,
                  r.startedAt,
                  r.finishedAt,
                  r.id,
                ]),
              },
            ]}
          />
        }
      >
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
      </Section>
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

      <Section
        title="Playbooks"
        note="Shared, PII-scrubbed steps by site and task"
        actions={
          <DownloadButton
            table="computer-playbooks"
            label="playbooks"
            disabled={data.playbooks.length === 0}
            sheets={() => [
              {
                name: 'Playbooks',
                columns: [
                  { header: 'Site' },
                  { header: 'Task type' },
                  { header: 'Version', type: 'integer' },
                  { header: 'Source' },
                  { header: 'Status' },
                  { header: 'Steps', type: 'integer' },
                  { header: 'Successes', type: 'integer' },
                  { header: 'Replay successes', type: 'integer' },
                  { header: 'Failures', type: 'integer' },
                  { header: 'Last success', type: 'datetime' },
                  { header: 'Updated', type: 'datetime' },
                  { header: 'Playbook id' },
                ],
                rows: data.playbooks.map((p) => [
                  p.site,
                  p.taskType,
                  p.version,
                  p.source,
                  p.status,
                  p.steps,
                  p.successCount,
                  p.replaySuccessCount,
                  p.failureCount,
                  p.lastSuccessAt,
                  p.updatedAt,
                  p.id,
                ]),
              },
            ]}
          />
        }
      >
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
      </Section>

      {coverage ? (
        <>
          <Section
            title="Site coverage and terms"
            note="Terms verdicts are staff-only. Sites whose terms ban automation are listed and practiced by the customer’s choice; Verisk sites are excluded"
            actions={
              <DownloadButton
                table="computer-site-coverage"
                label="site coverage and terms"
                sheets={() => [
                  {
                    name: 'Site coverage',
                    columns: [
                      { header: 'Site' },
                      { header: 'Category' },
                      { header: 'Terms' },
                      { header: 'Terms note' },
                      { header: 'Terms URL' },
                      { header: 'In picker' },
                      { header: 'Sign-in' },
                      { header: 'Two-step' },
                      { header: 'SSO' },
                      { header: 'Practice tasks', type: 'integer' },
                      { header: 'Needs a test Login' },
                      { header: 'Excluded reason' },
                    ],
                    rows: [
                      ...coverage.sites.map((s) => [
                        s.name,
                        s.category,
                        TERMS_TEXT[s.terms],
                        s.termsNote,
                        s.termsUrl,
                        s.inPicker,
                        s.signIn ? `${SIGN_IN_TEXT[s.signIn.flow]}${s.signIn.checked === 'blocked_probe' ? ' (help pages)' : ''}` : null,
                        s.twoStep,
                        s.sso,
                        s.practiceTasks.length,
                        s.needsTestLogin,
                        null,
                      ]),
                      ...coverage.excluded.map((e) => [e.name, null, null, null, null, null, null, null, null, null, null, e.reason]),
                    ],
                  },
                ]}
              />
            }
          >
          <div className="overflow-x-auto">
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
          </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}
