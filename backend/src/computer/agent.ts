/**
 * The Computer agent loop: a computer-use model looks at screenshots of a
 * hosted browser and asks for mouse and keyboard actions. Each action goes
 * through the approval gate (gate.ts) in code before it reaches the page.
 *
 * The loop is pure orchestration over injected parts (model, driver, store,
 * clock, metering), so tests drive it end to end with the mock provider and
 * a scripted model.
 */
import type { ComputerSettings } from './config.js';
import {
  classifyClick,
  classifyKey,
  classifyType,
  kindForApproval,
  newApprovalToken,
  originOf,
  ticketCovers,
  type ApprovalTicket,
  type GateDecision,
} from './gate.js';
import { countUnverifiedApprovalFields, verifyApprovalFields } from './projection.js';
import { checkPlacement } from './fieldPlacement.js';
import {
  ALREADY_SENT_APPROVAL_MESSAGE,
  actionFingerprint,
  findConsumedMatchingApproval,
  isSendLikeApproval,
} from './sendIdempotency.js';
import {
  ALREADY_ORDERED_APPROVAL_MESSAGE,
  approvedOrderFingerprint,
  approvedOrderInstructions,
  excludedItemsStillOnPage,
  findConsumedMatchingOrderApproval,
  orderLinesFromApprovalFields,
  isPlaceOrderLikeApproval,
  orderActionFingerprint,
} from './supplyOrder.js';
import { autoSignIn, findSavedSignIn, savedSignIns, trustedSites, type SavedSignIn } from './autoSignIn.js';
import { mfaPauseFromSignals } from './mfaPause.js';
import { isAskWebSearchConfigured, searchAskWeb, sanitizeAskWebQuery } from '../shared/askWebSearch.js';
import { siteOf } from './sites.js';
import {
  COMPUTER_CUSTOM_TOOLS,
  COMPUTER_DOM_TOOLS,
  COMPUTER_IQ_TOOLS,
  COMPUTER_SYSTEM_PROMPT,
  COMPUTER_TOOLSET,
  FILL_FIELDS_TOOL,
  USE_PLAYBOOK_TOOL,
  ATTACH_FILE_TOOL,
  CHECK_DOWNLOADS_TOOL,
  taskPrompt,
} from './prompt.js';
import { encodeTaskResult, resultFromFinish, type ComputerTaskResult } from './result.js';
import type { ComputerStore, ComputerTaskRow } from './store.js';
import type { ComputerDriver, ConsequentialKind, NeedsYouReason, RecordedAction, TaskFile } from './types.js';
import { OUTLINE_PREFIX, formatOutline } from './iq/perception.js';
import type { PlaybookStep, StepExpect, TraceEntry } from './iq/playbookSteps.js';
import { playbookBrief, replayPlaybook } from './iq/replay.js';
import { chooseRoute, type RoutingConfig } from './iq/routing.js';
import { runPreActionCheck } from './iq/preActionCheck.js';
import type { IqStore, PracticeMode, PracticeStepLog, RouteKind } from './iq/store.js';
import { fingerprint, waitForChange, waitForExpectation } from './iq/verify.js';

/* ------------------------------------------------------------------ model -- */

export interface ComputerModelRequest {
  model: string;
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  tools: unknown[];
  messages: AgentMessage[];
  max_tokens: number;
}

export interface ComputerModelResponse {
  model: string;
  content: ContentBlock[];
  usage: unknown;
  stop_reason?: string | null;
}

export interface ComputerModel {
  create(request: ComputerModelRequest): Promise<ComputerModelResponse>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ContentBlock = { type: string; [key: string]: any };
export interface AgentMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

/* ---------------------------------------------------------------- outcome -- */

export interface AgentOutcome {
  status: 'succeeded' | 'failed' | 'canceled';
  summary?: string;
  /** Structured result from finish (fields, submitted, note). */
  result?: ComputerTaskResult;
  error?: string;
  submitted?: boolean;
  /** Model calls this run made (agent steps plus independent checks). */
  modelCalls?: number;
  /** Practice runs: where the run stopped and why. */
  practice?: {
    stoppedAt?: { kind: ConsequentialKind; label: string };
    needsYouReason?: NeedsYouReason;
    stuckAt?: string;
  };
  /** A saved playbook this run replayed (use_playbook). */
  usedPlaybook?: { id: string; taskType: string; version: number; status: string };
  /** The kind of the last approved consequential click (for playbook capture). */
  approvedKind?: ConsequentialKind | null;
}

/** A saved playbook the model may replay with use_playbook. */
export interface AgentPlaybook {
  id: string;
  taskType: string;
  version: number;
  steps: PlaybookStep[];
}

/**
 * Computer IQ hooks: practice mode, playbooks, routing, the independent
 * pre-action check, demonstration recording and the action trace. Every part
 * is optional so a bare run behaves like the original loop.
 */
export interface AgentIq {
  store?: IqStore | null;
  /** Per-step model routing; null keeps the task's model for every step. */
  routing?: RoutingConfig | null;
  /** Independent check before irreversible steps. null turns it off (tests only). */
  verifier?: { model: ComputerModel; modelId: string } | null;
  /** Practice runs never wait for a person and never submit. */
  practice?: { mode: PracticeMode } | null;
  /** Saved playbooks for this site (offered through use_playbook). */
  playbooks?: AgentPlaybook[];
  /** Server note for the first prompt (for example how far a replay got). */
  promptNote?: string | null;
  /** True when a playbook replay just failed (routes the first step to the strong model). */
  afterReplayFailure?: boolean;
  /** Verified actions are appended here (playbook capture on success). */
  trace?: TraceEntry[];
  /** One entry per action, for practice run detail. */
  stepLog?: PracticeStepLog[];
  /** After each model turn (practice runs keep screenshots). */
  onTurn?(step: number, label: string | null): Promise<void>;
  /** A person's Take control session ended: turn it into a playbook draft. */
  onDemonstration?(
    actions: RecordedAction[],
    source: 'demonstration' | 'handoff',
  ): Promise<{ draftId: string | null; steps: number; summary: string } | null>;
}

export interface AgentRun {
  task: ComputerTaskRow;
  driver: ComputerDriver;
  model: ComputerModel;
  store: ComputerStore;
  settings: ComputerSettings;
  /** Meter one model call; returns its provider cost in nanodollars. */
  meterModel(step: number | string, response: ComputerModelResponse): Promise<number>;
  /** Provider cost of browser time so far (for the budget). */
  browserCostNanos(): number;
  isPaused(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  iq?: AgentIq | null;
  /** Files the person gave this task for uploads (bytes stay server-side). */
  files?: TaskFile[];
  /** Starter hints for this kind of site (from the site catalog). */
  siteGuide?: string[];
}

const NOT_EXECUTED = 'Not executed: an earlier computer action in this turn failed.';

type WaitResult = 'approved' | 'declined' | 'resumed' | 'canceled' | 'timeout' | 'took_control';

class Halt extends Error {
  constructor(readonly outcome: AgentOutcome) {
    super(outcome.error ?? outcome.status);
  }
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

function imageBlock(data: string): ContentBlock {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
}

/** Keep only the newest page outline in the transcript (they are large and go stale). */
export function pruneOutlines(messages: AgentMessage[]): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    for (const block of msg.content) {
      const list = block.type === 'tool_result' && Array.isArray(block.content) ? (block.content as ContentBlock[]) : [block];
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const b = list[k];
        if (b.type !== 'text' || typeof b.text !== 'string' || !b.text.startsWith(OUTLINE_PREFIX)) continue;
        seen += 1;
        if (seen > 1) list[k] = textBlock('(older page outline removed)');
      }
    }
  }
}

/** Plain reason a practice run stopped at a step only a person can do. */
function practiceStopMessage(reason: NeedsYouReason, message: string): string {
  switch (reason) {
    case 'login':
      return 'Needs a saved Login: the site asked to sign in.';
    case 'two_factor':
    case 'number_match':
      return 'The site asked for a two-step verification, which only a person can complete.';
    case 'captcha':
      return 'The site showed a captcha. Computer never solves captchas.';
    case 'clarification':
      return `Computer needed an answer: ${clip(message, 200)}`;
    default:
      return clip(message, 300) || 'Stopped at a step that needs a person.';
  }
}

function isComputerMember(block: ContentBlock): boolean {
  return block.type === 'tool_use' && (block.toolset_name === 'computer' || block.name === 'computer');
}

function memberAction(block: ContentBlock): string {
  if (block.toolset_name === 'computer') return String(block.name ?? '');
  return String(block.input?.action ?? '');
}

/** Keep only the newest `keep` screenshots in the transcript. */
export function pruneScreenshots(messages: AgentMessage[], keep: number): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j -= 1) {
      const block = msg.content[j];
      const nested = block.type === 'tool_result' && Array.isArray(block.content) ? (block.content as ContentBlock[]) : null;
      const list = nested ?? [block];
      for (let k = list.length - 1; k >= 0; k -= 1) {
        if (list[k].type !== 'image') continue;
        seen += 1;
        if (seen > keep) {
          if (nested) nested[k] = textBlock('(older screenshot removed)');
          else msg.content[j] = textBlock('(older screenshot removed)');
        }
      }
    }
  }
}

function clip(text: unknown, max: number): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Registrable-ish site: last two labels (last three for short second-level like co.uk). */

/** Sites the task names: the start URL plus any URL or domain in the person's words. */
export function allowedSites(task: Pick<ComputerTaskRow, 'start_url' | 'instructions'>): Set<string> {
  const sites = new Set<string>();
  const add = (host: string | null) => {
    if (host) sites.add(siteOf(host));
  };
  if (task.start_url) add(hostOf(task.start_url));
  for (const m of task.instructions.matchAll(/https?:\/\/[^\s<>"')]+/gi)) add(hostOf(m[0]));
  const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|txt|jpe?g|png|gif|heic|webp|mp4|mov|zip)$/i;
  for (const m of task.instructions.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,12})\b/gi)) {
    if (!FILE_EXT.test(m[1])) add(m[1].toLowerCase());
  }
  return sites;
}

export async function runComputerAgent(run: AgentRun): Promise<AgentOutcome> {
  const { task, driver, model, store, settings } = run;
  const sites = allowedSites(task);
  let ticket: ApprovalTicket | null = null;
  let cost = Number(task.cost_nanos) || 0;
  let step = Number(task.step_count) || 0;
  let lastHeartbeat = 0;
  let captchaAckUrl: string | null = null;
  const iq = run.iq ?? null;
  const practice = iq?.practice ?? null;
  const trace = iq?.trace ?? [];
  let modelCalls = 0;
  /** Actions in a row that did not take effect (verification failures). */
  let consecutiveFailures = 0;
  /** Model turns in a row that started on an unchanged page. */
  let noProgressTurns = 0;
  let lastTurnFp: string | null = null;
  let lastTurnFailed = false;
  let afterHandoff = false;
  let afterReplayFailure = Boolean(iq?.afterReplayFailure);
  let fastUnavailable = false;
  let lastRouteModel: string | null = null;
  let checkProblems = 0;
  let pendingNote: string | null = null;
  let usedPlaybook: AgentOutcome['usedPlaybook'];
  let approvedKind: ConsequentialKind | null = null;
  let recording = false;
  let pauseReason: NeedsYouReason | null = null;

  const audit = (event: string, detail: Record<string, unknown> = {}, actor: 'agent' | 'system' = 'agent') =>
    store
      .appendAudit({
        org_id: task.org_id,
        task_id: task.id,
        session_id: task.session_id,
        job_id: task.job_id,
        actor_kind: actor,
        event,
        detail,
      })
      .catch(() => undefined);

  const heartbeat = async (patch: Partial<ComputerTaskRow> = {}) => {
    lastHeartbeat = run.now();
    await store.updateTask(task.id, { heartbeat_at: new Date(lastHeartbeat).toISOString(), ...patch });
  };

  const logRoute = async (route: RouteKind, modelId: string, reason: string) => {
    await iq?.store
      ?.logRoute({ org_id: task.org_id, task_id: task.id, step, route, model: modelId, reason })
      .catch(() => undefined);
    if (route === 'fallback' || route === 'verify' || route === 'replay' || modelId !== lastRouteModel) {
      await audit('model_route', { route, model: modelId, reason: clip(reason, 120) }, 'system');
      if (route !== 'verify' && route !== 'replay') lastRouteModel = modelId;
    }
  };

  /** Record a person's Take control session (Learn by demonstration). */
  const startRecording = async () => {
    if (recording || !driver.startRecording || !iq?.onDemonstration) return;
    try {
      await driver.startRecording();
      recording = true;
      await audit('recording_started', {}, 'system');
    } catch {
      recording = false;
    }
  };

  /** Stop recording; the person's steps become a draft playbook that a reviewer approves before use. */
  const finishRecording = async () => {
    if (!recording || !driver.stopRecording || !iq?.onDemonstration) return;
    recording = false;
    const actions = await driver.stopRecording().catch(() => [] as RecordedAction[]);
    if (!actions.length) return;
    const source = pauseReason === 'stuck' ? 'handoff' : 'demonstration';
    const draft = await iq.onDemonstration(actions, source).catch(() => null);
    if (!draft) return;
    if (draft.draftId) await audit('playbook_draft_created', { kind: source, status: 'pending', steps: draft.steps }, 'system');
    pendingNote = draft.summary;
  };

  /** Poll the task (and an approval) until a person acts, cancels, or the idle timeout passes. */
  const waitForPerson = async (kind: 'approval' | 'needs_you' | 'control', approvalId?: string): Promise<WaitResult> => {
    try {
      return await pollForPerson(kind, approvalId);
    } finally {
      if (kind !== 'approval') await finishRecording();
    }
  };

  const pollForPerson = async (kind: 'approval' | 'needs_you' | 'control', approvalId?: string): Promise<WaitResult> => {
    const started = run.now();
    if (kind === 'control') await startRecording();
    for (;;) {
      await run.sleep(settings.pollMs);
      const fresh = await store.getTask(null, task.id);
      if (!fresh || fresh.cancel_requested_at) return 'canceled';
      if (kind === 'needs_you' && fresh.human_control_by) await startRecording();
      if (kind === 'approval' && approvalId) {
        const a = await store.getApproval(null, approvalId);
        if (a?.status === 'approved') return 'approved';
        if (fresh.human_control_by) return 'took_control';
        if (a && a.status !== 'pending') return 'declined';
      }
      // resume_requested_at is cleared when the pause starts, so any value is this pause's Resume.
      if (kind === 'needs_you' && fresh.resume_requested_at) return 'resumed';
      if (kind === 'control' && !fresh.human_control_by) return 'resumed';
      if (run.now() - started > settings.idleTimeoutMs) return 'timeout';
      if (run.now() - lastHeartbeat > 15_000) await heartbeat();
    }
  };

  /** A person holds the mouse: wait for them to hand it back. */
  const waitForControlRelease = async () => {
    await store.updateTask(task.id, { status_detail: 'You have control. Hand it back when you are done.' });
    const result = await waitForPerson('control');
    if (result === 'canceled') throw new Halt({ status: 'canceled', summary: 'Canceled.' });
    if (result === 'timeout') {
      throw new Halt({ status: 'failed', error: 'Stopped: nobody handed control back within the idle timeout.' });
    }
    await audit('control_returned', {}, 'system');
    await store.updateTask(task.id, { status_detail: null });
  };

  const pauseForPerson = async (reason: NeedsYouReason, message: string, extra: { screenshot?: string | null } = {}): Promise<'resumed'> => {
    if (practice) {
      // Practice runs never wait on a person: record why and stop.
      await audit('practice_stopped', { reason });
      throw new Halt({
        status: 'failed',
        error: practiceStopMessage(reason, message),
        practice: { needsYouReason: reason, ...(reason === 'stuck' ? { stuckAt: clip(message, 200) } : {}) },
      });
    }
    pauseReason = reason;
    const since = new Date(run.now()).toISOString();
    await store.transitionTask(task.id, ['running'], {
      status: 'needs_you',
      needs_you: {
        reason,
        message: clip(message, 400),
        since,
        ...(extra.screenshot && extra.screenshot.length <= 600_000 ? { screenshot_jpeg_b64: extra.screenshot } : {}),
      },
      status_detail: clip(message, 400),
      resume_requested_at: null,
      heartbeat_at: since,
    });
    await audit('needs_you', { reason });
    const result = await waitForPerson('needs_you');
    if (result === 'canceled') throw new Halt({ status: 'canceled', summary: 'Canceled while waiting for you.' });
    if (result === 'timeout') {
      throw new Halt({ status: 'failed', error: 'Stopped: nobody finished the step in the live view within the idle timeout.' });
    }
    await store.transitionTask(task.id, ['needs_you'], {
      status: 'running',
      needs_you: null,
      status_detail: null,
      resume_requested_at: null,
    });
    await audit('resumed', { reason }, 'system');
    pauseReason = null;
    afterHandoff = true;
    consecutiveFailures = 0;
    noProgressTurns = 0;
    return 'resumed';
  };

  /** Where the browser is, in words a person recognizes. */
  const whereAmI = async (): Promise<string> => {
    const outline = driver.pageOutline ? await driver.pageOutline().catch(() => null) : null;
    const host = hostOf(await driver.currentUrl().catch(() => '')) ?? 'the site';
    const title = clip(outline?.headings?.[0] || outline?.title, 80);
    return title ? `“${title}” on ${host}` : host;
  };

  /**
   * Hand off when stuck: a screenshot and "Stuck at X. Take over, or tell me Y."
   * A practice run records the failure instead of waiting.
   */
  const handOffStuck = async (where: string, need: string, why: string): Promise<string> => {
    await audit('stuck', { why });
    const cleanNeed = clip(need, 160).replace(/[.?!]+$/, '');
    const message = `Stuck at ${clip(where, 140)}. Take over, or tell me ${cleanNeed}.`;
    const shot = practice ? null : await driver.screenshot('jpeg').catch(() => null);
    await pauseForPerson('stuck', message, { screenshot: shot });
    return 'The person handled it (or answered) and pressed Resume. Take a screenshot, read any new instruction, and continue.';
  };

  const screenshotBlock = async () => imageBlock(await driver.screenshot('png'));

  /** Screenshot plus the DOM outline (DOM first: the model targets by role and name). */
  const observe = async (): Promise<ContentBlock[]> => {
    const blocks = [await screenshotBlock()];
    if (driver.pageOutline) {
      const outline = await driver.pageOutline().catch(() => null);
      if (outline && outline.elements.length) blocks.push(textBlock(formatOutline(outline)));
    }
    return blocks;
  };

  const logStep = (label: string, ok: boolean, note?: string) => {
    if (!iq?.stepLog) return;
    iq.stepLog.push({ index: iq.stepLog.length, label: clip(label, 160), ok, via: 'model', ...(note ? { note: clip(note, 200) } : {}) });
  };

  const NOTHING_CHANGED =
    'did not change anything on the page (no navigation, text, focus or field change). It may be covered, disabled or not clickable. Look at the page outline and try a different element, close what is covering it, or scroll.';

  /**
   * One gated, verified click. Used by left_click and click_element, so both
   * go through the same approval gate and the same "did it work" check.
   */
  const clickAt = async (
    x: number,
    y: number,
    opts: { action: string; button?: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: string[]; expect?: StepExpect; verify: boolean },
  ): Promise<{ content: ContentBlock[]; isError: boolean; verifiedFailure?: boolean }> => {
    const fail = (text: string, verifiedFailure = false) => ({ content: [textBlock(text)], isError: true, verifiedFailure });
    const target = await driver.describeTarget(x, y);
    const decision = opts.button && opts.button !== 'left' ? { type: 'allow' as const } : classifyClick(target);
    const gate = await passGate(decision, opts.action);
    if (!gate.ok) return fail(gate.text);
    const urlBefore = await driver.currentUrl().catch(() => null);
    const before = opts.verify ? await fingerprint(driver) : null;
    await driver.click(x, y, { button: opts.button ?? 'left', clickCount: opts.clickCount ?? 1, modifiers: opts.modifiers });
    const label = target?.label ? `Clicked “${clip(target.label, 60)}”` : 'Clicked on the page';
    let verified: boolean | null = null;
    let unmet: string | null = null;
    if (opts.verify && before != null) {
      const { changed } = await waitForChange(driver, before, run.sleep, { timeoutMs: 1_500 });
      unmet = await waitForExpectation(driver, opts.expect, run.sleep, changed ? 6_000 : 1_000);
      verified = changed && !unmet;
    }
    await audit('action', {
      action: opts.action,
      target: target ? { tag: target.tag, label: clip(target.label, 80) } : null,
      consequential: decision.type === 'consequential' ? decision.kind : null,
      ...(verified === false ? { outcome: 'no_change' } : {}),
    });
    await store.updateTask(task.id, { last_action: clip(label, 300) });
    if (verified === false) {
      logStep(label, false, unmet ?? 'Nothing changed.');
      return fail(unmet ? `${label}, but ${unmet}.` : `${label}, but that click ${NOTHING_CHANGED}`, true);
    }
    if (decision.type !== 'consequential') {
      trace.push({
        kind: 'click',
        target: target ? { role: target.role, name: target.label, tag: target.tag } : null,
        urlBefore,
        urlAfter: await driver.currentUrl().catch(() => null),
      });
    }
    logStep(label, true);
    return { content: [textBlock('Done.')], isError: false };
  };

  /** Gate a consequential action: only an approved, unconsumed ticket lets it through. */
  const passGate = async (decision: GateDecision, action: string): Promise<{ ok: true } | { ok: false; text: string }> => {
    if (decision.type === 'allow') return { ok: true };
    if (decision.type === 'block') {
      await audit('blocked', { action, why: decision.message });
      return { ok: false, text: `Blocked: ${decision.message}` };
    }
    if (decision.type === 'needs_you') {
      await audit('blocked', { action, why: decision.reason });
      await pauseForPerson(decision.reason, decision.message);
      return {
        ok: false,
        text: 'Not executed. The person was asked to handle this in the live view and has pressed Resume. Take a screenshot and continue.',
      };
    }
    if (practice) {
      await audit('blocked', { action, kind: decision.kind, label: decision.label, why: 'practice' });
      if (practice.mode === 'stop_before_submit') {
        throw new Halt({
          status: 'succeeded',
          summary: `Reached “${clip(decision.label, 120)}” and stopped before it. Nothing was submitted.`,
          practice: { stoppedAt: { kind: decision.kind, label: clip(decision.label, 120) } },
        });
      }
      return {
        ok: false,
        text: 'Blocked: this is a read-only practice run. Use only controls that look things up (for a search box, click the Search button instead of pressing Enter).',
      };
    }
    const url = await driver.currentUrl();
    if (ticket && ticketCovers(ticket, decision, url, run.now())) {
      // Unchecked lines must be out of the cart before the one approved click.
      if (ticket.order?.excluded.length) {
        const text = driver.visibleText ? await driver.visibleText().catch(() => null) : null;
        const still = text ? excludedItemsStillOnPage(ticket.order, text) : [];
        if (still.length) {
          await audit('blocked', { action, kind: decision.kind, label: decision.label, why: 'removed_items_in_cart' });
          return {
            ok: false,
            text: `Not clicked. These were unchecked by the person and are still in the cart: ${still.join('; ')}. Remove them, take a screenshot, then click "${decision.label}" again.`,
          };
        }
        if (!text) await audit('cart_check_skipped', { action, why: 'no_page_text' }, 'system');
      }
      const consumed = await store.consumeApproval(ticket.approvalId, ticket.tokenHash, new Date(run.now()).toISOString());
      const approvalId = ticket.approvalId;
      ticket = null;
      if (consumed) {
        await audit('approval_used', { approvalId, kind: decision.kind, label: decision.label, action });
        approvedKind = decision.kind;
        return { ok: true };
      }
    }
    await audit('blocked', { action, kind: decision.kind, label: decision.label, why: 'needs_approval' });
    return {
      ok: false,
      text: `Blocked: this ${decision.kind.replace('_', ' ')} action ("${decision.label}") needs the person's approval. Fill and check every field, then call request_approval with button_label "${decision.label}" and wait.`,
    };
  };

  const runMember = async (block: ContentBlock): Promise<{ content: ContentBlock[]; isError: boolean; verifiedFailure?: boolean }> => {
    const action = memberAction(block);
    const input = (block.input ?? {}) as Record<string, any>;
    const coord = Array.isArray(input.coordinate) ? (input.coordinate as number[]) : null;
    const inView = (c: number[] | null) =>
      c && c.length === 2 && c.every((n) => Number.isFinite(n)) && c[0] >= 0 && c[1] >= 0 &&
      c[0] <= driver.viewport.width && c[1] <= driver.viewport.height;
    const fail = (text: string) => ({ content: [textBlock(text)], isError: true });
    const done = async (label: string) => {
      await store.updateTask(task.id, { last_action: clip(label, 300) });
      return { content: [textBlock('Done.')], isError: false };
    };

    switch (action) {
      case 'screenshot':
        return { content: [await screenshotBlock()], isError: false };
      case 'cursor_position': {
        const [x, y] = await driver.cursorPosition();
        return { content: [textBlock(`Cursor at ${x}, ${y}.`)], isError: false };
      }
      case 'wait': {
        const seconds = Math.min(10, Math.max(0, Number(input.duration) || 1));
        await run.sleep(seconds * 1000);
        return { content: [await screenshotBlock()], isError: false };
      }
      case 'zoom':
        return { content: [await screenshotBlock()], isError: false };
      case 'mouse_move': {
        if (!inView(coord)) return fail('Coordinate is outside the screen.');
        await driver.move(coord![0], coord![1]);
        return { content: [textBlock('Done.')], isError: false };
      }
      case 'left_click':
      case 'double_click':
      case 'triple_click':
      case 'right_click':
      case 'middle_click': {
        if (!inView(coord)) return fail('Coordinate is outside the screen.');
        const [x, y] = coord!;
        const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
        const clickCount = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
        const modifiers = typeof input.text === 'string' && input.text ? input.text.split('+') : undefined;
        // Double and triple clicks usually select text, which changes nothing visible to the check.
        return clickAt(x, y, { action, button, clickCount, modifiers, verify: action === 'left_click' });
      }
      case 'left_mouse_down':
      case 'left_mouse_up': {
        const [x, y] = await driver.cursorPosition();
        const decision = classifyClick(await driver.describeTarget(x, y));
        if (decision.type !== 'allow') {
          await audit('blocked', { action, why: 'use_left_click' });
          return fail('Blocked: use left_click for buttons and controls so the action can be checked.');
        }
        if (action === 'left_mouse_down') await driver.mouseDown('left');
        else await driver.mouseUp('left');
        return { content: [textBlock('Done.')], isError: false };
      }
      case 'left_click_drag': {
        const start = Array.isArray(input.start_coordinate) ? (input.start_coordinate as number[]) : await driver.cursorPosition();
        if (!inView(coord) || !inView(start)) return fail('Coordinate is outside the screen.');
        const decision = classifyClick(await driver.describeTarget(coord![0], coord![1]));
        if (decision.type !== 'allow') {
          await audit('blocked', { action, why: 'drag_onto_control' });
          return fail('Blocked: dragging onto that control is not allowed. Use left_click.');
        }
        await driver.drag([start[0], start[1]], [coord![0], coord![1]]);
        return done('Dragged on the page');
      }
      case 'scroll': {
        const at = inView(coord) ? coord! : [driver.viewport.width / 2, driver.viewport.height / 2];
        const dir = ['up', 'down', 'left', 'right'].includes(input.scroll_direction) ? input.scroll_direction : 'down';
        await driver.scroll(at[0], at[1], dir, Number(input.scroll_amount) || 3);
        return done(`Scrolled ${dir}`);
      }
      case 'type': {
        const text = String(input.text ?? '');
        if (!text) return fail('Nothing to type.');
        const focused = await driver.focusedElement();
        const gate = await passGate(classifyType(text, focused), action);
        if (!gate.ok) return fail(gate.text);
        const before = await fingerprint(driver);
        await driver.type(text);
        const { changed } = await waitForChange(driver, before, run.sleep, { timeoutMs: 1_000 });
        // Never log what was typed; it can be personal information.
        await audit('action', { action, chars: text.length, field: clip(focused?.label, 80) || null, ...(changed ? {} : { outcome: 'no_change' }) });
        const label = focused?.label ? `Typed in “${clip(focused.label, 60)}”` : 'Typed on the page';
        if (!changed) {
          logStep(label, false, 'The text did not appear.');
          return { content: [textBlock(`The text did not appear on the page. No field may be focused: click the field first (or use type_into).`)], isError: true, verifiedFailure: true };
        }
        trace.push({ kind: 'type', target: focused ? { role: focused.role ?? 'textbox', name: focused.label, tag: focused.tag } : null, value: text });
        logStep(label, true);
        return done(label);
      }
      case 'key': {
        const combo = String(input.text ?? '');
        if (!combo) return fail('No key given.');
        const focused = await driver.focusedElement();
        const gate = await passGate(classifyKey(combo, focused), action);
        if (!gate.ok) return fail(gate.text);
        const repeat = Math.min(50, Math.max(1, Number(input.repeat) || 1));
        // Keys that should visibly do something are checked; editing keys (Ctrl+A, arrows in text) are not.
        const checked = /^(return|enter|kp_enter|escape|tab|page_down|page_up|pagedown|pageup)$/i.test(combo.trim());
        const urlBefore = await driver.currentUrl().catch(() => null);
        const before = checked ? await fingerprint(driver) : null;
        await driver.key(combo, repeat);
        const { changed } = checked ? await waitForChange(driver, before, run.sleep, { timeoutMs: 1_500 }) : { changed: true };
        await audit('action', { action, key: clip(combo, 40), repeat, ...(changed ? {} : { outcome: 'no_change' }) });
        if (!changed) {
          logStep(`Pressed ${clip(combo, 40)}`, false, 'Nothing changed.');
          return { content: [textBlock(`Pressed ${clip(combo, 40)}, but it ${NOTHING_CHANGED}`)], isError: true, verifiedFailure: true };
        }
        if (/^(return|enter|kp_enter)$/i.test(combo.trim())) {
          trace.push({ kind: 'press', target: focused ? { role: focused.role ?? null, name: focused.label, tag: focused.tag } : null, urlBefore, urlAfter: await driver.currentUrl().catch(() => null) });
        }
        logStep(`Pressed ${clip(combo, 40)}`, true);
        return done(`Pressed ${clip(combo, 40)}`);
      }
      default:
        return fail(`Unsupported action "${clip(action, 40)}".`);
    }
  };

  /** Sites with a saved password, loaded once per run (empty when saving passwords is off). */
  let saved: SavedSignIn[] = [];
  /** Same rule as open_url: a saved sign-in is only used for a site this task names (any, if it names none). */
  const savedForTask = (entry: SavedSignIn, currentHost?: string | null): boolean => {
    const trusted = trustedSites(entry);
    if (sites.size === 0 || [...trusted].some((s) => sites.has(s))) return true;
    return Boolean(currentHost && trusted.has(siteOf(currentHost)));
  };

  /**
   * Let the server sign in with a saved password. Returns what to tell the
   * model; pauses for the person on a code, captcha or failure. The model only
   * ever sees the outcome text, never the username or password.
   */
  const useSavedSignIn = async (entry: SavedSignIn): Promise<string> => {
    const name = entry.login.label || entry.login.host;
    const result = await autoSignIn({
      store,
      driver,
      saved: entry,
      now: run.now,
      audit: { taskId: task.id, sessionId: task.session_id, jobId: task.job_id },
    });
    await store.updateTask(task.id, { current_url: clip(await driver.currentUrl(), 2000) || null, last_action: clip(result.message, 300) });
    switch (result.outcome) {
      case 'signed_in':
      case 'already_signed_in':
        return `${result.message} Take a screenshot and continue.`;
      case 'two_factor':
        await pauseForPerson('two_factor', result.message.includes('live view') ? result.message : `${result.message} Enter it in the live view, then press Resume.`);
        return 'The person entered the code and pressed Resume. Take a screenshot and continue.';
      case 'number_match': {
        const signals = await driver.pageSignals().catch(() => null);
        const pause = signals ? mfaPauseFromSignals(signals) : null;
        await pauseForPerson('number_match', pause?.message ?? result.message);
        return 'The person approved on their phone and pressed Resume. Take a screenshot and continue.';
      }
      case 'captcha':
        captchaAckUrl = await driver.currentUrl();
        await pauseForPerson('captcha', `${result.message} Computer never solves captchas. Please complete it in the live view, then press Resume.`);
        return 'The person handled the captcha and pressed Resume. Take a screenshot and continue.';
      case 'failed':
        await pauseForPerson('login', `${result.message} Please sign in yourself in the live view, then press Resume. An admin can update it on Logins.`);
        return 'The person signed in and pressed Resume. Take a screenshot and continue.';
      default:
        await pauseForPerson('login', `${result.message} Please sign in to ${name} in the live view, then press Resume.`);
        return 'The person signed in and pressed Resume. Take a screenshot and continue.';
    }
  };

  /** Independent check before an irreversible step. Fails closed. */
  const independentCheck = async (req: {
    buttonLabel: string;
    kind: ConsequentialKind;
    summary: string;
    fields: ReturnType<typeof verifyApprovalFields>;
    url: string;
  }): Promise<{ ok: true } | { ok: false; text: string }> => {
    const verifier = iq?.verifier;
    if (!verifier) return { ok: true };
    const pageText = driver.visibleText ? await driver.visibleText().catch(() => '') : '';
    const shot = await driver.screenshot('jpeg').catch(() => null);
    let concerns: string[] | null = null;
    let lastError = false;
    for (let attempt = 0; attempt < 2 && concerns == null; attempt += 1) {
      try {
        const { verdict, response } = await runPreActionCheck(verifier.model, verifier.modelId, {
          instructions: task.instructions,
          buttonLabel: req.buttonLabel,
          kind: req.kind,
          summary: req.summary,
          fields: req.fields,
          pageOrigin: originOf(req.url),
          pageText,
          screenshotJpegB64: shot,
        });
        modelCalls += 1;
        cost += await run.meterModel(`${step}-check-${checkProblems}-${attempt}`, response);
        concerns = verdict.ok ? [] : verdict.concerns.length ? verdict.concerns : ['The reviewer did not confirm this action.'];
        lastError = false;
      } catch {
        lastError = true;
      }
    }
    await logRoute('verify', verifier.modelId, `Independent check before “${clip(req.buttonLabel, 60)}”.`);
    if (concerns && concerns.length === 0) {
      await audit('pre_action_check', { kind: req.kind, label: req.buttonLabel, outcome: 'confirmed' });
      return { ok: true };
    }
    checkProblems += 1;
    await audit('pre_action_check', { kind: req.kind, label: req.buttonLabel, outcome: lastError ? 'unavailable' : 'flagged' });
    if (checkProblems >= 3) {
      const text = await handOffStuck(
        `the final check before “${clip(req.buttonLabel, 60)}”`,
        lastError ? 'to try the check again' : `how to resolve: ${clip((concerns ?? []).join('; '), 120)}`,
        'pre_action_check',
      );
      checkProblems = 0;
      return { ok: false, text };
    }
    if (lastError || !concerns) {
      return { ok: false, text: 'The independent check before this action could not run, so the approval was not shown. Take a screenshot and call request_approval again.' };
    }
    return {
      ok: false,
      text: `An independent check did not confirm this action, so the approval was not shown: ${concerns.join(' ')} Fix this on the page (or correct the summary and fields), then call request_approval again.`,
    };
  };

  /** Find an element for click_element / type_into: ref first, then role + name. */
  const locateFor = async (input: Record<string, any>) => {
    if (!driver.locate) return null;
    const ref = Number.isInteger(input.ref) ? Number(input.ref) : null;
    const name = typeof input.name === 'string' ? clip(input.name, 120) : null;
    const role = typeof input.role === 'string' ? clip(input.role, 30) : null;
    if (ref == null && !name) return null;
    let hit = await driver.locate({ ref, role, name }).catch(() => null);
    if (!hit && driver.dismissOverlays) {
      for (const o of await driver.dismissOverlays().catch(() => [])) await audit('overlay_dismissed', { kind: o.kind, label: clip(o.label, 60) });
      hit = await driver.locate({ ref, role, name }).catch(() => null);
    }
    if (!hit && name && role) hit = await driver.locate({ role: null, name }).catch(() => null);
    return hit;
  };

  /** Custom tools: open_url, request_approval, needs_you, sign_in_saved, finish, plus Computer IQ tools. */
  const runCustom = async (
    block: ContentBlock,
  ): Promise<{ text: string; isError: boolean; outcome?: AgentOutcome; acted?: boolean; verifiedFailure?: boolean }> => {
    const input = (block.input ?? {}) as Record<string, any>;
    switch (block.name) {
      case 'click_element': {
        const hit = await locateFor(input);
        if (!hit) {
          logStep('Find an element', false, 'Not found.');
          return { text: 'Could not find that element on the page. Use a ref from the latest page outline, or scroll and try again.', isError: true, verifiedFailure: true };
        }
        const expect: StepExpect = {};
        if (typeof input.expect_url_includes === 'string' && input.expect_url_includes) expect.urlIncludes = clip(input.expect_url_includes, 200);
        if (typeof input.expect_text === 'string' && input.expect_text) expect.textIncludes = clip(input.expect_text, 200);
        const out = await clickAt(hit.x, hit.y, { action: 'left_click', expect: Object.keys(expect).length ? expect : undefined, verify: true });
        const text = out.content.map((b) => String(b.text ?? '')).join(' ');
        return { text: out.isError ? text : `Clicked “${clip(hit.name, 60)}”.`, isError: out.isError, acted: !out.isError, verifiedFailure: out.verifiedFailure };
      }
      case 'type_into': {
        const value = String(input.text ?? '');
        if (!value) return { text: 'Nothing to type.', isError: true };
        const hit = await locateFor(input);
        if (!hit) return { text: 'Could not find that field on the page. Use a ref from the latest page outline.', isError: true, verifiedFailure: true };
        const target = await driver.describeTarget(hit.x, hit.y);
        if (!target?.isTextEntry && !target?.isTextarea) {
          return { text: `“${clip(hit.name, 60)}” is not a text field. Use click_element for buttons and links.`, isError: true };
        }
        const placed = checkPlacement({ label: hit.name || target.label || '', value, projection: task.job_projection ?? [], instructions: task.instructions });
        if (!placed.ok) {
          await audit('blocked', { action: 'type', why: 'placement', field: clip(hit.name, 80) });
          return { text: `Not typed: ${placed.problem}`, isError: true };
        }
        const typeGate = await passGate(classifyType(value, target), 'type');
        if (!typeGate.ok) return { text: typeGate.text, isError: true };
        const clickGate = await passGate(classifyClick(target), 'left_click');
        if (!clickGate.ok) return { text: clickGate.text, isError: true };
        await driver.click(hit.x, hit.y);
        const before = await fingerprint(driver);
        await driver.key('ctrl+a');
        await driver.type(value);
        const { changed } = await waitForChange(driver, before, run.sleep, { timeoutMs: 1_000 });
        const label = `Typed in “${clip(hit.name, 60)}”`;
        await audit('action', { action: 'type', chars: value.length, field: clip(hit.name, 80), ...(changed ? {} : { outcome: 'no_change' }) });
        await store.updateTask(task.id, { last_action: clip(label, 300) });
        if (!changed) {
          logStep(label, false, 'The text did not appear.');
          return { text: `${label}, but the text did not appear in the field. Try clicking the field and typing.`, isError: true, verifiedFailure: true };
        }
        trace.push({ kind: 'type', target: { role: hit.role, name: hit.name, tag: hit.tag }, value });
        logStep(label, true);
        return { text: `${label}.`, isError: false, acted: true };
      }
      case 'fill_fields': {
        if (!driver.setField) return { text: 'This browser cannot fill fields in one step. Use type_into.', isError: true };
        const list = Array.isArray(input.fields) ? (input.fields as Array<Record<string, any>>).slice(0, 30) : [];
        if (!list.length) return { text: 'Give at least one field.', isError: true };
        const lines: string[] = [];
        let filled = 0;
        let problems = 0;
        for (const f of list) {
          const value = String(f.value ?? '');
          const hit = await locateFor(f);
          const name = clip(hit?.name ?? f.name ?? (f.ref != null ? `ref ${f.ref}` : 'field'), 60);
          if (!hit) {
            problems += 1;
            lines.push(`✗ “${name}”: not found on the page (use a ref from the latest outline).`);
            continue;
          }
          const target = await driver.describeTarget(hit.x, hit.y);
          const placed = checkPlacement({ label: hit.name || target?.label || '', value, projection: task.job_projection ?? [], instructions: task.instructions });
          if (!placed.ok) {
            problems += 1;
            await audit('blocked', { action: 'fill_fields', why: 'placement', field: clip(hit.name, 80) });
            lines.push(`✗ “${name}”: not filled. ${placed.problem}`);
            continue;
          }
          // Same gate as clicking and typing: terms boxes need approval, passwords and codes are never typed.
          const isChoice = Boolean(target?.isCheckbox) || /^(checkbox|radio|switch)$/i.test(hit.role);
          const gate = await passGate(isChoice ? classifyClick(target) : classifyType(value, target), isChoice ? 'left_click' : 'type');
          if (!gate.ok) {
            problems += 1;
            lines.push(`✗ “${name}”: ${gate.text}`);
            continue;
          }
          const res = await driver.setField(hit.x, hit.y, value);
          if (res.ok) {
            filled += 1;
            lines.push(`✓ “${name}” = “${clip(res.actual ?? value, 80)}” (${placed.source})`);
            if (!isChoice) trace.push({ kind: 'type', target: { role: hit.role, name: hit.name, tag: hit.tag }, value });
          } else {
            problems += 1;
            lines.push(`✗ “${name}”: ${res.note ?? 'did not take the value'}.`);
          }
        }
        // Counts only: values can be personal information.
        await audit('action', { action: 'fill_fields', fields: list.length, filled, problems });
        await store.updateTask(task.id, { last_action: clip(`Filled ${filled} of ${list.length} fields`, 300) });
        logStep(`Filled ${filled} of ${list.length} fields`, problems === 0, problems ? `${problems} not filled` : undefined);
        const text = `${lines.join('\n')}${problems ? '\nFix the ✗ fields (right field, a value from the job or the person, or leave blank) before asking for approval.' : ''}`;
        return { text, isError: filled === 0, acted: filled > 0, verifiedFailure: filled === 0 };
      }
      case 'attach_file': {
        const file = (run.files ?? []).find((f) => f.id === String(input.file_id ?? ''));
        if (!file) return { text: 'That file_id is not in <task_files>.', isError: true };
        if (!driver.attachFiles) return { text: 'This browser cannot attach files.', isError: true };
        const hit = await locateFor(input);
        if (!hit) return { text: 'Could not find that file field or upload button. Use a ref from the latest page outline.', isError: true, verifiedFailure: true };
        const gate = await passGate({ type: 'consequential', kind: 'upload', label: hit.name || 'Choose file' }, 'attach_file');
        if (!gate.ok) return { text: gate.text, isError: true };
        const before = await fingerprint(driver);
        const res = await driver.attachFiles(hit.x, hit.y, [file]);
        if (res !== 'attached') {
          logStep(`Attach ${file.name}`, false, 'No file field there.');
          return { text: `“${clip(hit.name, 60)}” is not a file field or upload button.`, isError: true, verifiedFailure: true };
        }
        const { changed } = await waitForChange(driver, before, run.sleep, { timeoutMs: 2_000 });
        await audit('action', { action: 'attach_file', file: clip(file.name, 120), bytes: file.bytes.length, field: clip(hit.name, 80), ...(changed ? {} : { outcome: 'no_change' }) });
        await store.updateTask(task.id, { last_action: clip(`Attached ${file.name}`, 300) });
        logStep(`Attached ${file.name}`, true);
        return {
          text: changed
            ? `Attached ${file.name}. Take a screenshot to confirm the page shows it.`
            : `Attached ${file.name}, but the page did not visibly change. Take a screenshot and check that it shows the file.`,
          isError: false,
          acted: true,
        };
      }
      case 'check_downloads': {
        const list = driver.downloads ? await driver.downloads().catch(() => []) : [];
        if (!list.length) return { text: 'No downloads in this session yet. If you clicked a download link, wait a moment and check again.', isError: false };
        await audit('downloads_checked', { count: list.length });
        return {
          text: `Downloaded in this session:\n${list.map((d) => `- ${d.name}${d.bytes != null ? ` (${Math.max(1, Math.round(d.bytes / 1024))} KB)` : ''}`).join('\n')}`,
          isError: false,
        };
      }
      case 'report_stuck': {
        const where = clip(input.where, 140) || (await whereAmI());
        const need = clip(input.need, 160) || 'what to do next';
        return { text: await handOffStuck(where, need, 'model_reported'), isError: false };
      }
      case 'use_playbook': {
        const taskType = clip(input.task_type, 60).toLowerCase();
        const pb = (iq?.playbooks ?? []).find((x) => x.taskType === taskType);
        if (!pb) return { text: `No playbook "${taskType}" for this site.`, isError: true };
        const params: Record<string, string> = {};
        if (input.values && typeof input.values === 'object') {
          for (const [k, v] of Object.entries(input.values as Record<string, unknown>).slice(0, 20)) {
            if (typeof v === 'string' && /^[a-z][a-z0-9_]{0,40}$/i.test(k)) params[k] = v.slice(0, 500);
          }
        }
        await logRoute('replay', 'none', `Following saved playbook ${taskType} v${pb.version}.`);
        const replay = await replayPlaybook(
          { driver, sleep: run.sleep, audit: (event, detail) => audit(event, detail ?? {}) },
          { steps: pb.steps, slots: { projection: task.job_projection ?? [], params, instructions: task.instructions }, sites },
        );
        trace.push(...replay.trace);
        for (const l of replay.log) iq?.stepLog?.push({ index: iq.stepLog.length, label: l.label, ok: l.ok, via: 'playbook', ...(l.note ? { note: l.note } : {}) });
        usedPlaybook = { id: pb.id, taskType, version: pb.version, status: replay.status };
        if (replay.status === 'failed') await iq?.store?.recordPlaybookReplay(pb.id, false).catch(() => undefined);
        await audit('playbook_replayed', { kind: taskType, status: replay.status, outcome: `${replay.done}/${pb.steps.length}` });
        await store.updateTask(task.id, { current_url: clip(await driver.currentUrl(), 2000) || null });
        if (replay.status === 'completed') {
          return { text: `The playbook finished all ${pb.steps.length} steps. Take a screenshot, check the result, then continue or finish.`, isError: false, acted: true };
        }
        if (replay.status === 'stopped_at_consequential' && replay.stoppedAt) {
          if (practice?.mode === 'stop_before_submit') {
            throw new Halt({
              status: 'succeeded',
              summary: `Reached “${clip(replay.stoppedAt.label, 120)}” and stopped before it. Nothing was submitted.`,
              practice: { stoppedAt: replay.stoppedAt },
            });
          }
          return {
            text: `The playbook stopped before “${clip(replay.stoppedAt.label, 80)}”, which needs approval. Check every field, then call request_approval.`,
            isError: false,
            acted: true,
          };
        }
        afterReplayFailure = true;
        return {
          text: `The playbook completed ${replay.done} of ${pb.steps.length} steps and stopped${replay.failedStep != null ? ` at step ${replay.failedStep + 1}` : ''}: ${clip(replay.reason, 200)} Continue from here yourself.`,
          isError: false,
          acted: replay.done > 0,
        };
      }
      case 'open_url': {
        const url = String(input.url ?? '').trim();
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { text: 'That is not a valid URL.', isError: true };
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          await audit('blocked', { action: 'open_url', why: 'scheme' });
          return { text: 'Blocked: only http(s) web addresses can be opened.', isError: true };
        }
        const site = siteOf(parsed.hostname.toLowerCase());
        if (sites.size > 0 && !sites.has(site)) {
          await audit('blocked', { action: 'open_url', why: 'outside_task', host: parsed.hostname });
          return {
            text: `Blocked: ${parsed.hostname} is not a site this task names. Stay on ${[...sites].join(', ')}, or follow links on the page.`,
            isError: true,
          };
        }
        let opened = false;
        for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
          try {
            await driver.navigate(parsed.toString());
            opened = true;
          } catch {
            await run.sleep(1_500 * (attempt + 1));
          }
        }
        if (!opened) return { text: 'The page did not load after three tries. Try again later or use a link on the current page.', isError: true };
        trace.push({ kind: 'navigate', url: parsed.toString() });
        await audit('navigate', { host: parsed.hostname });
        await store.updateTask(task.id, { current_url: clip(await driver.currentUrl(), 2000), last_action: `Opened ${parsed.hostname}` });
        return { text: 'Opened. Take a screenshot to see it.', isError: false };
      }
      case 'request_approval': {
        const buttonLabel = clip(input.button_label, 200);
        const summary = clip(input.summary, 1000);
        if (!buttonLabel || !summary) return { text: 'button_label and summary are required.', isError: true };
        const url = await driver.currentUrl();
        const fields = verifyApprovalFields({
          claimed: Array.isArray(input.fields) ? input.fields : [],
          projection: task.job_projection ?? [],
          instructions: task.instructions,
          onPage: await driver.readFormFields(),
        });
        const kind = kindForApproval(buttonLabel);
        if (isSendLikeApproval(buttonLabel, kind)) {
          const fingerprint = actionFingerprint({
            kind,
            origin: originOf(url),
            buttonLabel,
            fields,
          });
          const prior = findConsumedMatchingApproval(
            await store.listApprovalsForTask(task.id, 40),
            fingerprint,
          );
          if (prior) {
            await audit('approval_blocked_duplicate_send', {
              priorApprovalId: prior.id,
              kind,
              label: buttonLabel,
            });
            return { text: ALREADY_SENT_APPROVAL_MESSAGE, isError: false };
          }
        }
        if (isPlaceOrderLikeApproval(buttonLabel, kind)) {
          const fingerprint = orderActionFingerprint({
            kind,
            origin: originOf(url),
            buttonLabel,
            fields,
          });
          const knownQty = orderLinesFromApprovalFields(fields).filter((l) => l.quantity != null);
          const cartFingerprint = knownQty.length
            ? approvedOrderFingerprint({
                origin: originOf(url),
                buttonLabel,
                lines: knownQty.map((l) => ({ sku: l.sku, material: l.material, quantity: l.quantity as number })),
              })
            : null;
          const prior = findConsumedMatchingOrderApproval(
            await store.listApprovalsForTask(task.id, 40),
            fingerprint,
            cartFingerprint,
          );
          if (prior) {
            await audit('approval_blocked_duplicate_order', {
              priorApprovalId: prior.id,
              kind,
              label: buttonLabel,
            });
            return { text: ALREADY_ORDERED_APPROVAL_MESSAGE, isError: false };
          }
        }
        const check = await independentCheck({ buttonLabel, kind, summary, fields, url });
        if (!check.ok) return { text: check.text, isError: false };
        if (practice) {
          await audit('practice_stopped', { kind, label: buttonLabel, reason: 'approval' });
          if (practice.mode === 'read_only') {
            throw new Halt({
              status: 'failed',
              error: `A read-only practice task reached an approval step (“${clip(buttonLabel, 80)}”).`,
              practice: { stoppedAt: { kind, label: buttonLabel } },
            });
          }
          throw new Halt({
            status: 'succeeded',
            summary: `Ready for approval at “${clip(buttonLabel, 120)}” and stopped there. Nothing was submitted.`,
            practice: { stoppedAt: { kind, label: buttonLabel } },
          });
        }
        const shot = await driver.screenshot('jpeg');
        const { token, tokenHash } = newApprovalToken();
        const expiresAt = run.now() + settings.approvalTtlMs;
        const approval = await store.insertApproval({
          org_id: task.org_id,
          task_id: task.id,
          action_kind: kind,
          button_label: buttonLabel,
          summary,
          page_url: clip(url, 2000) || null,
          page_origin: originOf(url),
          fields,
          screenshot_jpeg_b64: shot,
          token_hash: tokenHash,
          expires_at: new Date(expiresAt).toISOString(),
        });
        const since = new Date(run.now()).toISOString();
        await store.transitionTask(task.id, ['running'], {
          status: 'awaiting_approval',
          status_detail: `Waiting for your approval to click “${buttonLabel}”.`,
          heartbeat_at: since,
        });
        await audit('approval_requested', {
          approvalId: approval.id,
          kind,
          label: buttonLabel,
          fields: fields.length,
          unverified: countUnverifiedApprovalFields(fields),
        });
        const result = await waitForPerson('approval', approval.id);
        if (result === 'took_control') {
          await store.expireApproval(approval.id);
          await store.transitionTask(task.id, ['awaiting_approval'], { status: 'running' });
          await audit('approval_superseded', { approvalId: approval.id, why: 'took_control' }, 'system');
          await waitForControlRelease();
          return {
            text: 'The person took control to make changes and has handed back. Take a screenshot, re-check every field, then call request_approval again.',
            isError: false,
          };
        }
        if (result === 'canceled') throw new Halt({ status: 'canceled', summary: 'Canceled at the approval step. Nothing was submitted.' });
        if (result === 'timeout') {
          await store.expireApproval(approval.id);
          throw new Halt({ status: 'failed', error: 'Stopped: the approval was not answered within the idle timeout. Nothing was submitted.' });
        }
        await store.transitionTask(task.id, ['awaiting_approval'], { status: 'running', status_detail: null });
        if (result === 'declined') {
          await audit('approval_declined', { approvalId: approval.id }, 'system');
          throw new Halt({ status: 'canceled', summary: 'You declined the approval. Nothing was submitted.' });
        }
        ticket = {
          approvalId: approval.id,
          token,
          tokenHash,
          kind,
          buttonLabel,
          origin: originOf(url),
          expiresAt,
        };
        const decided = await store.getApproval(null, approval.id);
        const order = decided?.approved_order ?? null;
        if (order) {
          ticket.order = order;
          await audit(
            'approval_granted',
            {
              approvalId: approval.id,
              approvedLines: order.lines.length,
              excludedLines: order.excluded.length,
              orderFingerprint: order.fingerprint,
            },
            'system',
          );
          return { text: approvedOrderInstructions(buttonLabel, order), isError: false };
        }
        await audit('approval_granted', { approvalId: approval.id }, 'system');
        return {
          text: `Approved. You may click “${buttonLabel}” once now. Any other submit-type click needs a new approval.`,
          isError: false,
        };
      }
      case 'needs_you': {
        const reason = (['login', 'two_factor', 'number_match', 'captcha', 'clarification', 'stuck', 'other'].includes(input.reason) ? input.reason : 'other') as NeedsYouReason;
        const message = clip(input.message, 400) || 'Please take over in the live view, then press Resume.';
        if (reason === 'login' && saved.length) {
          // A sign-in page for a site with a saved password: the server signs in first.
          const host = hostOf(await driver.currentUrl());
          const entry = host ? saved.find((s) => trustedSites(s).has(siteOf(host))) : undefined;
          if (entry) return { text: await useSavedSignIn(entry), isError: false };
        }
        await pauseForPerson(reason, message);
        return { text: 'The person pressed Resume. Take a screenshot and continue.', isError: false };
      }
      case 'sign_in_saved': {
        const entry = findSavedSignIn(saved, clip(input.site, 300));
        if (entry && !savedForTask(entry, hostOf(await driver.currentUrl()))) {
          await audit('blocked', { action: 'sign_in_saved', why: 'outside_task', host: entry.login.host });
          return { text: `Blocked: ${entry.login.host} is not a site this task names.`, isError: true };
        }
        if (!entry) {
          const known = saved.map((s) => s.login.host).join(', ') || 'none';
          return { text: `No saved sign-in for that site (saved: ${known}). Use needs_you with reason "login" instead.`, isError: true };
        }
        return { text: await useSavedSignIn(entry), isError: false };
      }
      case 'look_up_how_to': {
        const query = clip(input.query, 200);
        if (!query) return { text: 'Say what to look up (site and goal).', isError: true };
        if (!isAskWebSearchConfigured()) {
          return {
            text: 'Public web look-up is not available right now. Try the page again, or call ask_clarification with one clear question for the person.',
            isError: false,
          };
        }
        const safe = sanitizeAskWebQuery(query) || query;
        await audit('look_up_how_to', { host: hostOf(await driver.currentUrl()) ?? undefined });
        try {
          const hits = await searchAskWeb(safe, { limit: 3 });
          if (!hits.length) {
            return {
              text: 'No useful how-to results. Try a different query, or call ask_clarification.',
              isError: false,
            };
          }
          const notes = hits
            .slice(0, 3)
            .map((h, i) => `${i + 1}. ${clip(h.title, 80)} — ${clip(h.snippet, 220)}`)
            .join('\n');
          return {
            text: `How-to notes (act on the live page; do not open these URLs unless the task named them):\n${notes}`,
            isError: false,
          };
        } catch {
          return { text: 'Look-up failed. Call ask_clarification if you still need help.', isError: false };
        }
      }
      case 'ask_clarification': {
        const question = clip(input.question, 400);
        if (!question) return { text: 'Ask one clear question.', isError: true };
        await pauseForPerson('clarification', question);
        return {
          text: 'The person answered (or pressed Resume). Read any new instruction in Chat context from the status, take a screenshot, and continue. If still unclear, ask again once.',
          isError: false,
        };
      }
      case 'finish': {
        const result = resultFromFinish(input);
        return {
          text: 'Finished.',
          isError: false,
          outcome: { status: 'succeeded', summary: encodeTaskResult(result), result, submitted: result.submitted },
        };
      }
      default:
        return { text: `Unknown tool "${clip(block.name, 40)}".`, isError: true };
    }
  };

  const tools: unknown[] = [
    COMPUTER_TOOLSET,
    ...COMPUTER_CUSTOM_TOOLS,
    ...(driver.locate ? COMPUTER_DOM_TOOLS : []),
    ...(driver.locate && driver.setField ? [FILL_FIELDS_TOOL] : []),
    ...COMPUTER_IQ_TOOLS,
    ...(iq?.playbooks?.length ? [USE_PLAYBOOK_TOOL] : []),
    ...(run.files?.length && driver.attachFiles && driver.locate ? [ATTACH_FILE_TOOL] : []),
    ...(driver.downloads ? [CHECK_DOWNLOADS_TOOL] : []),
  ];
  const system = [{ type: 'text' as const, text: COMPUTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }];
  const decorate = (o: AgentOutcome): AgentOutcome => ({
    ...o,
    modelCalls,
    ...(usedPlaybook ? { usedPlaybook } : {}),
    approvedKind,
  });
  /** Give the model a server note (for example what a person just did in Take control). */
  const noteToModel = (messages: AgentMessage[], text: string) => {
    const last = messages[messages.length - 1];
    if (last?.role === 'user') last.content.push(textBlock(text));
    else messages.push({ role: 'user', content: [textBlock(text)] });
  };

  try {
    await heartbeat({ current_url: clip(await driver.currentUrl(), 2000) || null });
    saved = (await savedSignIns(store, task.org_id).catch(() => [] as SavedSignIn[])).filter((s) => savedForTask(s));
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          textBlock(
            taskPrompt({
              instructions: task.instructions,
              startUrl: task.start_url,
              projection: task.job_projection ?? [],
              savedSignIns: saved.map((s) => ({ label: s.login.label, host: s.login.host })),
              playbooks: (iq?.playbooks ?? []).map((pb) => ({ taskType: pb.taskType, brief: playbookBrief(pb.steps) })),
              note: iq?.promptNote ?? null,
              files: (run.files ?? []).map((f) => ({ id: f.id, name: f.name, sizeKb: Math.max(1, Math.round(f.bytes.length / 1024)) })),
              siteGuide: run.siteGuide ?? [],
            }),
          ),
          ...(await observe()),
        ],
      },
    ];

    while (step < task.max_steps) {
      const fresh = await store.getTask(null, task.id);
      if (!fresh || fresh.cancel_requested_at) return decorate({ status: 'canceled', summary: 'Canceled.' });
      if (fresh.human_control_by) {
        await waitForControlRelease();
        afterHandoff = true;
        noteToModel(messages, pendingNote ? `The person had control and handed back. ${pendingNote}` : 'The person had control and handed back. Take a screenshot before acting.');
        pendingNote = null;
      }
      if (await run.isPaused()) {
        return decorate({ status: 'failed', error: 'Stopped: AI is paused for this account until the allowance resets or credits are added.' });
      }
      const spent = cost + run.browserCostNanos();
      if (spent >= task.budget_nanos) {
        await audit('budget_reached', { spentNanos: spent, budgetNanos: task.budget_nanos }, 'system');
        return decorate({ status: 'failed', error: 'Stopped: this task reached its spending cap. Nothing more was done.' });
      }

      // Captchas and MFA pages pause before the model acts on them.
      const signals = await driver.pageSignals().catch(() => null);
      if (signals?.hasCaptcha && captchaAckUrl !== signals.url) {
        captchaAckUrl = signals.url;
        await pauseForPerson('captcha', 'This page has a captcha. Computer never solves captchas. Please complete it in the live view, then press Resume.');
        messages.push({ role: 'user', content: [textBlock('The person handled the captcha and pressed Resume.'), await screenshotBlock()] });
        pruneScreenshots(messages, settings.keepScreenshots);
        continue;
      }
      const mfa = signals ? mfaPauseFromSignals(signals) : null;
      if (mfa && captchaAckUrl !== signals!.url) {
        // Reuse captchaAckUrl as "already paused for this URL" so we do not loop.
        captchaAckUrl = signals!.url;
        await pauseForPerson(mfa.reason, mfa.message);
        messages.push({
          role: 'user',
          content: [
            textBlock(
              mfa.reason === 'number_match'
                ? 'The person approved on their phone and pressed Resume.'
                : 'The person entered the code and pressed Resume.',
            ),
            await screenshotBlock(),
          ],
        });
        pruneScreenshots(messages, settings.keepScreenshots);
        continue;
      }

      // Stuck detection: actions that keep failing, or a page that stops changing.
      const fpNow = await fingerprint(driver);
      noProgressTurns = fpNow != null && fpNow === lastTurnFp ? noProgressTurns + 1 : 0;
      lastTurnFp = fpNow;
      if (consecutiveFailures >= 3 || noProgressTurns >= 6) {
        const why = consecutiveFailures >= 3 ? 'actions_not_taking_effect' : 'no_progress';
        const text = await handOffStuck(await whereAmI(), 'what to click next', why);
        noteToModel(messages, pendingNote ? `${text} ${pendingNote}` : text);
        pendingNote = null;
        lastTurnFp = null;
      }

      step += 1;
      const pick = iq?.routing
        ? chooseRoute({ step, lastTurnFailed, afterHandoff, afterReplayFailure, noProgressTurns, fastUnavailable }, iq.routing, task.model_id)
        : null;
      afterHandoff = false;
      afterReplayFailure = false;
      const modelId = pick?.model ?? task.model_id;
      if (pick) await logRoute(pick.route, modelId, pick.reason);
      const request = { system, tools, messages, max_tokens: 2048 };
      let response: ComputerModelResponse;
      try {
        response = await model.create({ model: modelId, ...request });
      } catch (err) {
        if (!pick || pick.route !== 'fast' || modelId === task.model_id) throw err;
        // The fast model is unavailable (or rejected the request): the task's own model takes over.
        fastUnavailable = true;
        await logRoute('fallback', task.model_id, 'The fast model did not answer; using the task model.');
        response = await model.create({ model: task.model_id, ...request });
      }
      modelCalls += 1;
      cost += await run.meterModel(step, response);
      await heartbeat({ step_count: step, cost_nanos: cost });

      const content = Array.isArray(response.content) ? response.content : [];
      messages.push({ role: 'assistant', content });
      const uses = content.filter((b) => b.type === 'tool_use');
      if (!uses.length) {
        const text = content
          .filter((b) => b.type === 'text')
          .map((b) => String(b.text ?? ''))
          .join('\n');
        return decorate({ status: 'succeeded', summary: clip(text, 4000) || 'Done.' });
      }

      const results: ContentBlock[] = [];
      let failed = false;
      let finished: AgentOutcome | null = null;
      let lastActedIndex = -1;
      let turnVerifiedFailure = false;
      let turnVerifiedSuccess = false;
      for (const block of uses) {
        const member = isComputerMember(block);
        const base: ContentBlock = { type: 'tool_result', tool_use_id: block.id };
        if (member) base.toolset_name = 'computer';
        if (failed || finished) {
          results.push({ ...base, content: [textBlock(NOT_EXECUTED)], is_error: true });
          continue;
        }
        if (member) {
          const out = await runMember(block);
          results.push({ ...base, content: out.content, ...(out.isError ? { is_error: true } : {}) });
          if (out.isError) failed = true;
          if (out.verifiedFailure) turnVerifiedFailure = true;
          else if (!out.isError && memberAction(block) !== 'screenshot') {
            lastActedIndex = results.length - 1;
            if (['left_click', 'type', 'key'].includes(memberAction(block))) turnVerifiedSuccess = true;
          }
        } else {
          const out = await runCustom(block);
          results.push({ ...base, content: out.acted ? [textBlock(out.text)] : out.text, ...(out.isError ? { is_error: true } : {}) });
          if (out.outcome) finished = out.outcome;
          if (out.verifiedFailure) {
            turnVerifiedFailure = true;
            failed = true;
          }
          if (out.acted) {
            lastActedIndex = results.length - 1;
            turnVerifiedSuccess = true;
          }
        }
      }
      if (finished) {
        await audit('finished', { submitted: Boolean(finished.submitted) });
        return decorate(finished);
      }
      lastTurnFailed = failed;
      if (turnVerifiedSuccess && !turnVerifiedFailure) consecutiveFailures = 0;
      else if (turnVerifiedFailure) consecutiveFailures += 1;
      // Show the page after the last action so the model sees what changed.
      if (lastActedIndex >= 0) {
        const r = results[lastActedIndex];
        r.content = [...(r.content as ContentBlock[]), ...(await observe())];
      }
      messages.push({ role: 'user', content: results });
      if (pendingNote) {
        noteToModel(messages, pendingNote);
        pendingNote = null;
      }
      pruneScreenshots(messages, settings.keepScreenshots);
      pruneOutlines(messages);
      await store.updateTask(task.id, { current_url: clip(await driver.currentUrl(), 2000) || null });
      await iq?.onTurn?.(step, (await store.getTask(null, task.id).catch(() => null))?.last_action ?? null);
    }
    await audit('step_cap', { steps: step }, 'system');
    return decorate({ status: 'failed', error: `Stopped after ${task.max_steps} steps without finishing. Nothing was submitted without your approval.` });
  } catch (err) {
    if (err instanceof Halt) return decorate(err.outcome);
    throw err;
  } finally {
    await store.updateTask(task.id, { step_count: step, cost_nanos: cost }).catch(() => undefined);
  }
}
