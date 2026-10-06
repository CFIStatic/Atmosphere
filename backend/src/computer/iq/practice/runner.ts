/**
 * Daily practice runs: Computer works through the standard practice tasks on
 * the practice org (the App Review demo org only), through the real worker,
 * agent, gate and playbook replay. Each task gets one row per day with its
 * result, failed step, screenshots, time, model calls and cost (staff only).
 *
 * Guards: the org must be COMPUTER_PRACTICE_ORG_ID; practice tasks never wait
 * for a person and never submit (agent.ts practice mode); a task whose site
 * has no saved Login is recorded as "needs login" without opening a browser.
 */
import { logger } from '../../../lib/logger.js';
import { computerWorkerDeps, runComputerTask, type ComputerWorkerDeps, type TaskRunHooks } from '../../worker.js';
import { siteOf } from '../../sites.js';
import type { ComputerTaskRow } from '../../store.js';
import type { IqStore, PracticeRunRow, PracticeStepLog } from '../store.js';
import { PRACTICE_TASKS, type PracticeTask } from './catalog.js';

/** Practice spend cap per task (provider cost), below the customer default. */
const PRACTICE_BUDGET_NANOS = 1_000_000_000;
const FINAL = new Set(['succeeded', 'failed', 'canceled']);

export class PracticeConfigError extends Error {}

export function practiceOrgId(): string | null {
  const v = (process.env.COMPUTER_PRACTICE_ORG_ID ?? '').trim();
  return /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null;
}

export function utcDate(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function loginFor(task: PracticeTask, logins: Array<{ host: string }>): boolean {
  if (!task.loginHost) return true;
  const want = siteOf(task.loginHost);
  return logins.some((l) => l.host === task.loginHost || siteOf(l.host) === want);
}

function firstFailedStep(log: PracticeStepLog[]): number | null {
  const i = log.findIndex((s) => !s.ok);
  return i >= 0 ? i : log.length ? log.length - 1 : null;
}

async function waitForFinal(deps: ComputerWorkerDeps, taskId: string, maxMs = 45 * 60_000): Promise<ComputerTaskRow | null> {
  const started = deps.now();
  for (;;) {
    const t = await deps.store.getTask(null, taskId);
    if (!t || FINAL.has(t.status)) return t;
    if (deps.now() - started > maxMs) return t;
    await deps.sleep(5_000);
  }
}

export interface PracticeSuiteOptions {
  orgId: string;
  runDate?: string;
  /** Only these task keys (default: every catalog task). */
  keys?: string[];
  /** Re-run a task that already ran today (staff "Run now"). */
  force?: boolean;
  deps?: ComputerWorkerDeps | null;
  /** Override the catalog (tests). */
  tasks?: PracticeTask[];
}

/** Run one practice task end to end and record it. Returns the final row (null when another process owns today's run). */
export async function runPracticeTask(task: PracticeTask, opts: PracticeSuiteOptions & { deps: ComputerWorkerDeps; iq: IqStore }): Promise<PracticeRunRow | null> {
  const { deps, iq } = opts;
  const runDate = opts.runDate ?? utcDate(deps.now());
  if (opts.force) {
    const existing = (await iq.listPracticeRuns(runDate)).find((r) => r.org_id === opts.orgId && r.task_key === task.key && r.run_date === runDate);
    if (existing && existing.status !== 'running') await iq.deletePracticeRun(existing.id);
  }
  const run = await iq.claimPracticeRun({ org_id: opts.orgId, run_date: runDate, site: task.site, task_key: task.key, task_type: task.taskType, mode: task.mode });
  if (!run) return null;
  const started = deps.now();
  const finish = async (patch: Partial<PracticeRunRow>) => {
    const at = deps.now();
    await iq.updatePracticeRun(run.id, { finished_at: new Date(at).toISOString(), duration_ms: Math.max(0, at - started), ...patch });
    return iq.getPracticeRun(run.id);
  };

  const logins = await deps.store.listLogins(opts.orgId).catch(() => []);
  if (!loginFor(task, logins)) {
    return finish({
      status: 'needs_login',
      failure_reason: `No saved Login for ${task.loginHost}. Save one on the practice org's Logins page to include this task.`,
    });
  }
  if (await deps.store.activeTask(opts.orgId)) {
    return finish({ status: 'skipped', failure_reason: 'Another Computer task was running on the practice org.' });
  }

  let row: ComputerTaskRow;
  try {
    row = await deps.store.insertTask({
      org_id: opts.orgId,
      job_id: null,
      created_by: null,
      instructions: task.instructions,
      start_url: task.startUrl,
      job_projection: [],
      model_id: deps.settings.model,
      max_steps: task.maxSteps,
      budget_nanos: Math.min(deps.settings.budgetNanos, PRACTICE_BUDGET_NANOS),
      practice: {
        runId: run.id,
        taskKey: task.key,
        taskType: task.taskType,
        mode: task.mode,
        ...(task.params ? { params: task.params } : {}),
        ...(task.success ? { success: task.success } : {}),
      },
    });
  } catch (err) {
    return finish({ status: 'skipped', failure_reason: `Could not queue the task: ${err instanceof Error ? err.message.slice(0, 200) : 'error'}` });
  }
  await iq.updatePracticeRun(run.id, { task_id: row.id });

  const hooks: TaskRunHooks = { stepLog: [], playbook: { id: null, version: null, used: false } };
  let outcome = await runComputerTask(row.id, deps, hooks);
  const final = outcome ? await deps.store.getTask(null, row.id) : await waitForFinal(deps, row.id);
  if (!outcome && final) {
    outcome = { status: final.status === 'succeeded' ? 'succeeded' : 'failed', error: final.error ?? undefined };
  }
  const steps = hooks.stepLog ?? [];
  const status: PracticeRunRow['status'] =
    outcome?.status === 'succeeded'
      ? 'succeeded'
      : outcome?.practice?.needsYouReason === 'login'
        ? 'needs_login'
        : 'failed';
  return finish({
    status,
    failed_step: status === 'succeeded' ? null : firstFailedStep(steps),
    failure_reason: status === 'succeeded' ? null : (outcome?.error ?? final?.error ?? 'The task did not finish.').slice(0, 500),
    steps,
    playbook_id: hooks.playbook?.id ?? null,
    playbook_version: hooks.playbook?.version ?? null,
    used_playbook: Boolean(hooks.playbook?.used),
    model_calls: outcome?.modelCalls ?? 0,
    cost_nanos: Math.max(0, Math.round(Number(final?.cost_nanos) || 0)),
  });
}

/** Run the practice suite sequentially (the org's browser runs one task at a time). */
export async function runPracticeSuite(opts: PracticeSuiteOptions): Promise<PracticeRunRow[]> {
  const allowed = practiceOrgId();
  if (!allowed || opts.orgId.toLowerCase() !== allowed) {
    throw new PracticeConfigError('Practice runs only run on the practice org (COMPUTER_PRACTICE_ORG_ID).');
  }
  const deps = opts.deps ?? computerWorkerDeps();
  if (!deps?.iq) throw new PracticeConfigError('Computer is not configured on this server.');
  const tasks = (opts.tasks ?? PRACTICE_TASKS).filter((t) => !opts.keys?.length || opts.keys.includes(t.key));
  const out: PracticeRunRow[] = [];
  for (const task of tasks) {
    try {
      const row = await runPracticeTask(task, { ...opts, deps, iq: deps.iq });
      if (row) out.push(row);
    } catch (err) {
      logger.warn('computer practice task failed to record', { key: task.key, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  }
  return out;
}

/** Mark practice rows left "running" by a restart as failed. */
export async function failStalePracticeRuns(iq: IqStore, now = Date.now()): Promise<number> {
  const rows = await iq.listPracticeRuns(utcDate(now - 2 * 86_400_000));
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'running' || now - Date.parse(r.started_at) < 60 * 60_000) continue;
    await iq.updatePracticeRun(r.id, { status: 'failed', failure_reason: 'Interrupted: the server restarted during this practice run.', finished_at: new Date(now).toISOString() });
    n += 1;
  }
  return n;
}
