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
import { runComputerAgent, type AgentIq, type AgentOutcome, type AgentPlaybook, type ComputerModel } from './agent.js';
import { siteOf } from './sites.js';
import { describeStep, stepsFromRecording, stepsFromTrace, type PlaybookStep, type TraceEntry } from './iq/playbookSteps.js';
import { replayPlaybook } from './iq/replay.js';
import { routingConfig } from './iq/routing.js';
import { SupabaseIqStore, type IqStore, type PracticeStepLog } from './iq/store.js';
import { unmetExpectation } from './iq/verify.js';
import { computerSettings, helperSessionStale, NOT_SET_UP_MESSAGE, type ComputerSettings } from './config.js';
import { browserCostSoFar, meterBrowserTime, meterComputerModelCall } from './metering.js';
import { anthropicComputerModel } from './model.js';
import { computerProvider, providerForTask, windowsDesktopProvider } from './providers/index.js';
import { SupabaseComputerStore, type ComputerStore, type ComputerTaskRow } from './store.js';
import type { ComputerDriver, ComputerProvider, ComputerSessionHandle, TaskFile } from './types.js';
import { isAutomationRestrictedSite, siteGuideFor } from './catalog/sites.js';
import { desktopAppForUrl } from './desktop/config.js';

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
  /** Computer IQ storage (practice runs, playbooks, drafts, routing). null = off. */
  iq?: IqStore | null;
  /**
   * Model for the independent pre-action check. undefined = the task's model
   * (production). Tests that inject a scripted model pass one explicitly or
   * get no check.
   */
  verifyModel?: ComputerModel | null;
  /** Files the person gave a task for uploads. Not wired to job documents yet. */
  taskFiles?(task: ComputerTaskRow): Promise<TaskFile[]>;
}

/** The harmless text file the upload practice task attaches (it never gets uploaded: the run stops at approval). */
export function practiceUploadFile(): TaskFile {
  return { id: 'practice-1', name: 'atmosphere-practice.txt', mimeType: 'text/plain', bytes: Buffer.from('Atmosphere Computer practice upload. Safe to ignore.\n') };
}

/** What a caller (the practice runner) wants back from a run beyond the outcome. */
export interface TaskRunHooks {
  stepLog?: PracticeStepLog[];
  /** Filled with what happened to a practice task's playbook. */
  playbook?: { id: string | null; version: number | null; used: boolean };
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
    iq: 'iq' in o ? (o.iq ?? null) : computerIqStore(),
    ...('verifyModel' in o ? { verifyModel: o.verifyModel ?? null } : {}),
    ...(o.taskFiles ? { taskFiles: o.taskFiles } : {}),
  };
}

export function computerIqStore(): IqStore | null {
  if (overrides && 'iq' in overrides) return overrides.iq ?? null;
  const admin = computerAdmin();
  return admin ? new SupabaseIqStore(admin) : null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Plain recap of a person's recorded steps for the model (no values). */
function demoSummary(steps: PlaybookStep[], drafted: boolean): string {
  const lines = steps.slice(0, 8).map((s, i) => `${i + 1}. ${describeStep(s)}`);
  return [
    'While the person had control they did:',
    ...lines,
    drafted ? 'These steps were saved as a draft playbook for review. Nothing they typed was saved.' : '',
    'Take a screenshot and continue from here.',
  ]
    .filter(Boolean)
    .join('\n');
}

function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Never echo URLs (a CDP or live-view URL carries a signed token).
  return msg.replace(/\b(?:wss?|https?):\/\/\S+/gi, '[url]').slice(0, 300);
}

const inFlight = new Set<string>();

/** Claim and run one task to completion. Resolves when the task has a final status. */
export async function runComputerTask(taskId: string, given?: ComputerWorkerDeps, hooks: TaskRunHooks = {}): Promise<AgentOutcome | null> {
  const d = given ?? computerWorkerDeps();
  if (!d) return null;
  const { store, settings } = d;
  const task = await store.getTask(null, taskId);
  if (!task || task.status !== 'queued') return null;
  // A task that opens a desktop app runs on the org's Windows computer; every
  // other task runs in the cloud browser. The choice is fixed for the task.
  const provider = providerForTask({ orgId: task.org_id, startUrl: task.start_url }, d.provider);
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
        if (task.start_url && /^(https?|app):\/\//i.test(task.start_url)) {
          await driver.navigate(task.start_url);
          await audit('navigate', { host: new URL(task.start_url).hostname });
        }
        await store.updateTask(task.id, { status_detail: null });
        const sessionStart = handle.startedAt.getTime();
        const iqStore = d.iq ?? null;
        const practice = task.practice ?? null;
        const startHost = hostOf(task.start_url);
        const desktopApp = provider.id === 'windows' ? desktopAppForUrl(task.start_url) : null;
        // No web playbooks for Verisk sites (EXCLUDED_SITES) or for desktop apps.
        const site = provider.id === 'windows' || isAutomationRestrictedSite(startHost) ? null : siteOf(startHost ?? '') || null;
        const trace: TraceEntry[] = [];
        const stepLog = hooks.stepLog ?? [];
        const slots = { projection: task.job_projection ?? [], params: practice?.params ?? {}, instructions: task.instructions };
        const sites = new Set(site ? [site] : []);
        const iqAudit = (event: string, detail: Record<string, unknown> = {}) =>
          store
            .appendAudit({ org_id: task.org_id, task_id: task.id, session_id: running.session_id, job_id: task.job_id, actor_kind: 'agent', event, detail })
            .catch(() => undefined);
        let screenIndex = 0;
        const keepScreen = async (label: string) => {
          if (!practice || !iqStore || !driver) return;
          const jpeg = await driver.screenshot('jpeg').catch(() => null);
          if (jpeg) await iqStore.insertPracticeScreen({ run_id: practice.runId, step_index: screenIndex++, label, jpeg_b64: jpeg }).catch(() => undefined);
        };
        await keepScreen('Start page');

        // Practice tasks have a known task type: follow the saved playbook first, then fall back to the model.
        let replayOutcome: AgentOutcome | null = null;
        let promptNote: string | null = null;
        let afterReplayFailure = false;
        const playbook = practice && iqStore && site ? await iqStore.loadPlaybook(site, practice.taskType).catch(() => null) : null;
        if (hooks.playbook) hooks.playbook = { id: playbook?.id ?? null, version: playbook?.version ?? null, used: false };
        if (practice && playbook && playbook.status === 'active' && playbook.steps.length && iqStore) {
          if (hooks.playbook) hooks.playbook.used = true;
          await iqStore.logRoute({ org_id: task.org_id, task_id: task.id, step: 0, route: 'replay', model: 'none', reason: `Following saved playbook ${playbook.task_type} v${playbook.version}.` }).catch(() => undefined);
          const replay = await replayPlaybook({ driver, sleep: d.sleep, audit: iqAudit }, { steps: playbook.steps, slots, sites });
          trace.push(...replay.trace);
          for (const l of replay.log) stepLog.push({ index: stepLog.length, label: l.label, ok: l.ok, via: 'playbook', ...(l.note ? { note: l.note } : {}) });
          await keepScreen('After playbook');
          const met = practice.success ? (await unmetExpectation(driver, practice.success)) == null : true;
          if (replay.status === 'completed' && met && practice.mode === 'read_only') {
            replayOutcome = { status: 'succeeded', summary: `Followed playbook v${playbook.version}; every step was verified.`, modelCalls: 0 };
          } else if (replay.status === 'stopped_at_consequential' && replay.stoppedAt && practice.mode === 'stop_before_submit') {
            replayOutcome = {
              status: 'succeeded',
              summary: `Followed playbook v${playbook.version} to “${replay.stoppedAt.label}” and stopped before it. Nothing was submitted.`,
              practice: { stoppedAt: replay.stoppedAt },
              modelCalls: 0,
            };
          }
          if (replayOutcome) {
            await iqStore.recordPlaybookReplay(playbook.id, true).catch(() => undefined);
          } else {
            const where = replay.failedStep != null ? `step ${replay.failedStep + 1} of ${playbook.steps.length}` : 'the end';
            if (replay.status === 'failed' || (replay.status === 'completed' && !met)) {
              await iqStore.recordPlaybookReplay(playbook.id, false).catch(() => undefined);
              afterReplayFailure = true;
            }
            promptNote = `A saved playbook for this task ran first and completed ${replay.done} of ${playbook.steps.length} steps, stopping at ${where}${replay.reason ? `: ${replay.reason}` : '.'} Continue from the current page.`;
            await iqAudit('playbook_replayed', { kind: playbook.task_type, status: replay.status, outcome: `${replay.done}/${playbook.steps.length}` });
          }
        }

        const playbooks: AgentPlaybook[] =
          !practice && iqStore && site
            ? (await iqStore.listPlaybooks(site).catch(() => []))
                .filter((pb) => pb.status === 'active' && pb.steps.some((s) => s.kind !== 'explore'))
                .sort((a, b) => b.success_count + b.replay_success_count - (a.success_count + a.replay_success_count))
                .slice(0, 5)
                .map((pb) => ({ id: pb.id, taskType: pb.task_type, version: pb.version, steps: pb.steps }))
            : [];
        const routing = routingConfig(task.model_id);
        const verifyModel = d.verifyModel !== undefined ? d.verifyModel : d.model ? null : model;
        const iq: AgentIq = {
          store: iqStore,
          routing,
          verifier: verifyModel ? { model: verifyModel, modelId: routing.enabled ? routing.verify : task.model_id } : null,
          practice: practice ? { mode: practice.mode } : null,
          playbooks,
          promptNote,
          afterReplayFailure,
          trace,
          stepLog,
          onTurn: async (step) => {
            if (practice && step % 4 === 0) await keepScreen(`After step ${step}`);
          },
          onDemonstration: async (actions, source) => {
            const steps = stepsFromRecording(actions, slots);
            if (!steps.some((s) => s.kind !== 'explore')) return { draftId: null, steps: 0, summary: demoSummary(steps, false) };
            const draftSite = siteOf(hostOf(await driver!.currentUrl().catch(() => null)) ?? '') || site;
            let draftId: string | null = null;
            if (iqStore && draftSite) {
              const draft = await iqStore
                .insertDraft({ org_id: task.org_id, task_id: task.id, site: draftSite, task_type: practice?.taskType ?? 'demonstration', source, steps })
                .catch(() => null);
              draftId = draft?.id ?? null;
            }
            return { draftId, steps: steps.length, summary: demoSummary(steps, Boolean(draftId)) };
          },
        };
        outcome = replayOutcome ?? await runComputerAgent({
          task: running,
          driver,
          model,
          store,
          settings,
          iq,
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
          files: practice?.taskType === 'upload_file' ? [practiceUploadFile()] : await (d.taskFiles?.(task) ?? Promise.resolve([])).catch(() => []),
          siteGuide: desktopApp ? desktopApp.guide : siteGuideFor(startHost),
          surface: provider.id === 'windows' ? 'desktop' : 'browser',
        });

        // A practice task that says it finished must leave the expected result on the page.
        if (practice?.success && outcome.status === 'succeeded' && !outcome.practice?.stoppedAt && !replayOutcome) {
          const unmet = await unmetExpectation(driver, practice.success);
          if (unmet) outcome = { ...outcome, status: 'failed', error: `Finished, but ${unmet}.` };
          else if (practice.success.downloaded && !((await driver.downloads?.().catch(() => [])) ?? []).length) {
            outcome = { ...outcome, status: 'failed', error: 'Finished, but no file was downloaded.' };
          }
        }
        if (practice) await keepScreen(outcome.status === 'succeeded' ? 'Finished' : 'Where it stopped');

        // Playbook capture: a verified success refreshes the shared steps (PII-scrubbed).
        if (outcome.status === 'succeeded' && iqStore && site) {
          const taskType = practice?.taskType ?? outcome.usedPlaybook?.taskType ?? outcome.approvedKind ?? null;
          if (outcome.usedPlaybook && !practice) await iqStore.recordPlaybookReplay(outcome.usedPlaybook.id, true).catch(() => undefined);
          let steps = stepsFromTrace(trace, slots);
          const stop = outcome.practice?.stoppedAt;
          if (stop && !/^Enter in /.test(stop.label)) {
            steps = [...steps, { kind: 'click', target: { role: 'button', name: stop.label.slice(0, 80), tag: null }, consequential: stop.kind }];
          }
          if (taskType && !replayOutcome && steps.some((s) => s.kind === 'click' || s.kind === 'type')) {
            try {
              const saved = await iqStore.savePlaybookSteps({ site, taskType, steps, source: 'success' });
              await audit('playbook_saved', { kind: taskType, status: saved.changed ? 'updated' : 'confirmed' });
              if (hooks.playbook) hooks.playbook = { ...hooks.playbook, id: saved.id, version: saved.version };
            } catch (err) {
              logger.warn('computer playbook capture skipped', { taskId: task.id, error: safeError(err) });
            }
          }
        }
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
  // Stop any EC2 desktop that has been idle past its window (no-op unless one is set up).
  const windows = windowsDesktopProvider();
  if (windows.configured()) {
    await windows
      .stopIdleDesktops(async (orgId) => (await d.store.activeTask(orgId)) !== null)
      .catch((err) => logger.warn('computer desktop idle sweep failed', { error: safeError(err) }));
  }
  const queued = await d.store.listQueuedTasks(10);
  for (const t of queued) {
    if (inFlight.has(t.id)) continue;
    // The practice runner runs its own tasks; the sweep only picks up one it left behind.
    if (t.practice && d.now() - Date.parse(t.created_at) < 2 * 60_000) continue;
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
