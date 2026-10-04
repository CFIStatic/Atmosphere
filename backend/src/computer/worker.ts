/**
 * Runs queued Computer tasks. A sweep claims queued tasks with a conditional
 * update; the database allows one active task per org (the org's browser
 * profile can only be open once), so a second task waits its turn.
 *
 * MVP limit: a task lives in the process that claimed it. If that process
 * restarts, the sweep marks the task failed ("interrupted") once its
 * heartbeat goes stale, and the browser session times out on its own.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { assertAiFeatureAllowed, isAiPaused } from '../metering/aiBudgetService.js';
import { runComputerAgent, type AgentOutcome, type ComputerModel } from './agent.js';
import { computerSettings, helperSessionStale, NOT_SET_UP_MESSAGE, type ComputerSettings } from './config.js';
import { browserCostSoFar, meterBrowserTime, meterComputerModelCall } from './metering.js';
import { anthropicComputerModel } from './model.js';
import { computerProvider } from './providers/index.js';
import { SupabaseComputerStore, type ComputerStore, type ComputerTaskRow } from './store.js';
import type { ComputerDriver, ComputerProvider, ComputerSessionHandle } from './types.js';

export interface ComputerWorkerDeps {
  store: ComputerStore;
  provider: ComputerProvider;
  /** null → the Anthropic model for the org. */
  model: ComputerModel | null;
  meteringClient: SupabaseClient | null;
  isPaused(orgId: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  settings: ComputerSettings;
}

/** Test seams beyond the worker: the admin client and the AI allowance gate. */
export interface ComputerTestOverrides extends Partial<ComputerWorkerDeps> {
  admin?: SupabaseClient | null;
  assertAiAllowed?: (orgId: string, canManage: boolean) => Promise<void>;
}

let overrides: ComputerTestOverrides | null = null;

export function setComputerWorkerDepsForTests(next: ComputerTestOverrides | null): void {
  overrides = next;
}

/** Service-role client for Computer (tables, metering, allowance). */
export function computerAdmin(): SupabaseClient | null {
  if (overrides && 'admin' in overrides) return overrides.admin ?? null;
  return unscopedAdminOrNull();
}

/** Refuse to start when AI is paused for the org (allowance used up, no credits). */
export async function assertComputerAiAllowed(orgId: string, canManage: boolean): Promise<void> {
  if (overrides?.assertAiAllowed) return overrides.assertAiAllowed(orgId, canManage);
  const admin = computerAdmin();
  if (admin) await assertAiFeatureAllowed(admin, orgId, { canManage });
}

export function computerStore(): ComputerStore | null {
  if (overrides?.store) return overrides.store;
  const admin = computerAdmin();
  return admin ? new SupabaseComputerStore(admin) : null;
}

export function computerWorkerDeps(): ComputerWorkerDeps | null {
  const store = computerStore();
  if (!store) return null;
  const o = overrides ?? {};
  return {
    store,
    provider: o.provider ?? computerProvider(),
    model: o.model ?? null,
    meteringClient: 'meteringClient' in o ? (o.meteringClient ?? null) : computerAdmin(),
    isPaused:
      o.isPaused ??
      (async (orgId: string) => {
        const admin = computerAdmin();
        return admin ? isAiPaused(admin, orgId) : false;
      }),
    sleep: o.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: o.now ?? (() => Date.now()),
    settings: o.settings ?? computerSettings(),
  };
}

function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Never echo URLs (a CDP or live-view URL carries a signed token).
  return msg.replace(/\b(?:wss?|https?):\/\/\S+/gi, '[url]').slice(0, 300);
}

const inFlight = new Set<string>();

/** Claim and run one task to completion. Resolves when the task has a final status. */
export async function runComputerTask(taskId: string, given?: ComputerWorkerDeps): Promise<AgentOutcome | null> {
  const d = given ?? computerWorkerDeps();
  if (!d) return null;
  const { store, provider, settings } = d;
  const task = await store.getTask(null, taskId);
  if (!task || task.status !== 'queued') return null;
  // Someone is signing in to a site on the Logins page: the org's browser is
  // theirs until they finish. The task stays queued and runs after.
  const live = await store.liveSession(task.org_id);
  if (live && live.purpose !== 'task' && !helperSessionStale(live.started_at, d.now())) return null;
  const startedIso = new Date(d.now()).toISOString();
  const claimed = await store.transitionTask(task.id, ['queued'], {
    status: 'running',
    started_at: startedIso,
    heartbeat_at: startedIso,
    status_detail: 'Starting a browser…',
  });
  if (!claimed) return null;
  const audit = (event: string, detail: Record<string, unknown> = {}) =>
    store
      .appendAudit({ org_id: task.org_id, task_id: task.id, session_id: task.session_id, job_id: task.job_id, actor_kind: 'system', event, detail })
      .catch(() => undefined);
  await audit('task_started', { provider: provider.id, model: task.model_id });

  let outcome: AgentOutcome;
  let sessionRowId: string | null = null;
  let handle: ComputerSessionHandle | null = null;
  let driver: ComputerDriver | null = null;
  let browserCost = 0;
  const running: ComputerTaskRow = { ...task, status: 'running' };

  try {
    if (!provider.configured()) {
      outcome = { status: 'failed', error: NOT_SET_UP_MESSAGE };
    } else {
      const model = d.model ?? (await anthropicComputerModel(task.org_id));
      if (!model) {
        outcome = { status: 'failed', error: 'Model access is not configured on this server.' };
      } else {
        let contextId = await store.latestContextId(task.org_id, provider.id);
        if (!contextId) {
          contextId = await provider.createContext(task.org_id);
          await audit('context_created', {});
        }
        // We hold the org's only active task, so any live session is left over from a crash.
        for (const leftover of await store.closeLiveSessions(task.org_id)) {
          await provider.endSession(leftover).catch(() => undefined);
        }
        const sessionRow = await store.insertSession({ org_id: task.org_id, provider: provider.id, provider_context_id: contextId });
        sessionRowId = sessionRow.id;
        running.session_id = sessionRow.id;
        await store.updateTask(task.id, { session_id: sessionRow.id });
        handle = await provider.createSession({ orgId: task.org_id, contextId, timeoutSec: settings.sessionTimeoutSec });
        await store.updateSession(sessionRow.id, {
          status: 'active',
          provider_session_id: handle.providerSessionId,
          started_at: handle.startedAt.toISOString(),
        });
        await audit('session_started', { sessionId: sessionRow.id });
        driver = await provider.connect(handle);
        if (task.start_url && /^https?:\/\//i.test(task.start_url)) {
          await driver.navigate(task.start_url);
          await audit('navigate', { host: new URL(task.start_url).hostname });
        }
        await store.updateTask(task.id, { status_detail: null });
        const sessionStart = handle.startedAt.getTime();
        outcome = await runComputerAgent({
          task: running,
          driver,
          model,
          store,
          settings,
          meterModel: (step, response) =>
            meterComputerModelCall(d.meteringClient, {
              orgId: task.org_id,
              taskId: task.id,
              jobId: task.job_id,
              userId: task.created_by,
              step,
              response,
            }),
          browserCostNanos: () => browserCostSoFar((d.now() - sessionStart) / 1000),
          isPaused: () => d.isPaused(task.org_id),
          sleep: d.sleep,
          now: d.now,
        });
      }
    }
  } catch (err) {
    logger.error('computer task failed', { taskId: task.id, orgId: task.org_id, error: safeError(err) });
    outcome = { status: 'failed', error: `Computer hit an error: ${safeError(err)}` };
  } finally {
    await driver?.close().catch(() => undefined);
    if (handle) await provider.endSession(handle.providerSessionId).catch(() => undefined);
    if (sessionRowId && handle) {
      const seconds = Math.max(0, (d.now() - handle.startedAt.getTime()) / 1000);
      browserCost = meterBrowserTime(d.meteringClient, {
        orgId: task.org_id,
        taskId: task.id,
        sessionId: sessionRowId,
        jobId: task.job_id,
        userId: task.created_by,
        seconds,
      });
      await store
        .updateSession(sessionRowId, {
          status: 'ended',
          ended_at: new Date(d.now()).toISOString(),
          browser_seconds: Math.round(seconds),
          metered_at: new Date(d.now()).toISOString(),
        })
        .catch(() => undefined);
      await audit('session_ended', { sessionId: sessionRowId, browserSeconds: Math.round(seconds) });
    } else if (sessionRowId) {
      await store.updateSession(sessionRowId, { status: 'failed', ended_at: new Date(d.now()).toISOString() }).catch(() => undefined);
    }
  }

  const latest = await store.getTask(null, task.id);
  const finalStatus = latest?.cancel_requested_at && outcome.status !== 'succeeded' ? 'canceled' : outcome.status;
  await store.updateTask(task.id, {
    status: finalStatus,
    result_summary: outcome.summary ?? null,
    error: outcome.error ?? null,
    status_detail: null,
    needs_you: null,
    human_control_by: null,
    human_control_since: null,
    finished_at: new Date(d.now()).toISOString(),
    cost_nanos: (Number(latest?.cost_nanos) || 0) + browserCost,
  });
  await audit('task_finished', { status: finalStatus, submitted: Boolean(outcome.submitted) });
  return { ...outcome, status: finalStatus };
}

/** Fail tasks whose worker stopped heartbeating (process restart). */
export async function failInterruptedTasks(store: ComputerStore, now = Date.now()): Promise<number> {
  const stale = await store.listStaleActiveTasks(new Date(now - 5 * 60_000).toISOString());
  let n = 0;
  for (const t of stale) {
    if (inFlight.has(t.id)) continue;
    const ok = await store.transitionTask(t.id, ['running', 'awaiting_approval', 'needs_you'], {
      status: 'failed',
      error: 'Interrupted: the server restarted while this task was running. Nothing was submitted without approval. Start it again from Chat.',
      finished_at: new Date(now).toISOString(),
    });
    if (ok) {
      n += 1;
      await store
        .appendAudit({ org_id: t.org_id, task_id: t.id, job_id: t.job_id, actor_kind: 'system', event: 'interrupted', detail: {} })
        .catch(() => undefined);
    }
  }
  return n;
}

export async function sweepComputerTasksOnce(): Promise<void> {
  const d = computerWorkerDeps();
  if (!d) return;
  await failInterruptedTasks(d.store, d.now()).catch((err) =>
    logger.warn('computer interrupted sweep failed', { error: safeError(err) }),
  );
  const queued = await d.store.listQueuedTasks(10);
  for (const t of queued) {
    if (inFlight.has(t.id)) continue;
    inFlight.add(t.id);
    void runComputerTask(t.id, d)
      .catch((err) => logger.error('computer task crashed', { taskId: t.id, error: safeError(err) }))
      .finally(() => inFlight.delete(t.id));
  }
}

let timer: NodeJS.Timeout | null = null;

export function startComputerTaskSweep(intervalMs = 5_000): () => void {
  if (timer) return stopComputerTaskSweep;
  const tick = () => {
    void sweepComputerTasksOnce().catch((err) => logger.warn('computer sweep failed', { error: safeError(err) }));
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return stopComputerTaskSweep;
}

export function stopComputerTaskSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Called when Chat queues a task: run it now if this process runs workers. */
export function kickComputerWorker(): void {
  if (!timer) return;
  setImmediate(() => {
    void sweepComputerTasksOnce().catch(() => undefined);
  });
}
