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
import { verifyApprovalFields } from './projection.js';
import { COMPUTER_CUSTOM_TOOLS, COMPUTER_SYSTEM_PROMPT, COMPUTER_TOOLSET, taskPrompt } from './prompt.js';
import type { ComputerStore, ComputerTaskRow } from './store.js';
import type { ComputerDriver, NeedsYouReason } from './types.js';

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
  error?: string;
  submitted?: boolean;
}

export interface AgentRun {
  task: ComputerTaskRow;
  driver: ComputerDriver;
  model: ComputerModel;
  store: ComputerStore;
  settings: ComputerSettings;
  /** Meter one model call; returns its provider cost in nanodollars. */
  meterModel(step: number, response: ComputerModelResponse): Promise<number>;
  /** Provider cost of browser time so far (for the budget). */
  browserCostNanos(): number;
  isPaused(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
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
function siteOf(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const sld = parts[parts.length - 2];
  return parts.slice(sld.length <= 3 && parts[parts.length - 1].length === 2 ? -3 : -2).join('.');
}

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

  /** Poll the task (and an approval) until a person acts, cancels, or the idle timeout passes. */
  const waitForPerson = async (kind: 'approval' | 'needs_you' | 'control', approvalId?: string): Promise<WaitResult> => {
    const started = run.now();
    for (;;) {
      await run.sleep(settings.pollMs);
      const fresh = await store.getTask(null, task.id);
      if (!fresh || fresh.cancel_requested_at) return 'canceled';
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

  const pauseForPerson = async (reason: NeedsYouReason, message: string): Promise<'resumed'> => {
    const since = new Date(run.now()).toISOString();
    await store.transitionTask(task.id, ['running'], {
      status: 'needs_you',
      needs_you: { reason, message: clip(message, 400), since },
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
    return 'resumed';
  };

  const screenshotBlock = async () => imageBlock(await driver.screenshot('png'));

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
    const url = await driver.currentUrl();
    if (ticket && ticketCovers(ticket, decision, url, run.now())) {
      const consumed = await store.consumeApproval(ticket.approvalId, ticket.tokenHash, new Date(run.now()).toISOString());
      const approvalId = ticket.approvalId;
      ticket = null;
      if (consumed) {
        await audit('approval_used', { approvalId, kind: decision.kind, label: decision.label, action });
        return { ok: true };
      }
    }
    await audit('blocked', { action, kind: decision.kind, label: decision.label, why: 'needs_approval' });
    return {
      ok: false,
      text: `Blocked: this ${decision.kind.replace('_', ' ')} action ("${decision.label}") needs the person's approval. Fill and check every field, then call request_approval with button_label "${decision.label}" and wait.`,
    };
  };

  const runMember = async (block: ContentBlock): Promise<{ content: ContentBlock[]; isError: boolean }> => {
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
        const target = await driver.describeTarget(x, y);
        const decision = action === 'right_click' || action === 'middle_click' ? { type: 'allow' as const } : classifyClick(target);
        const gate = await passGate(decision, action);
        if (!gate.ok) return fail(gate.text);
        const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
        const clickCount = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
        const modifiers = typeof input.text === 'string' && input.text ? input.text.split('+') : undefined;
        await driver.click(x, y, { button, clickCount, modifiers });
        await audit('action', {
          action,
          target: target ? { tag: target.tag, label: clip(target.label, 80) } : null,
          consequential: decision.type === 'consequential' ? decision.kind : null,
        });
        return done(`${action.replace('_', ' ')} on “${clip(target?.label, 60) || 'the page'}”`);
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
        return done('drag');
      }
      case 'scroll': {
        const at = inView(coord) ? coord! : [driver.viewport.width / 2, driver.viewport.height / 2];
        const dir = ['up', 'down', 'left', 'right'].includes(input.scroll_direction) ? input.scroll_direction : 'down';
        await driver.scroll(at[0], at[1], dir, Number(input.scroll_amount) || 3);
        return done(`scroll ${dir}`);
      }
      case 'type': {
        const text = String(input.text ?? '');
        if (!text) return fail('Nothing to type.');
        const focused = await driver.focusedElement();
        const gate = await passGate(classifyType(text, focused), action);
        if (!gate.ok) return fail(gate.text);
        await driver.type(text);
        // Never log what was typed; it can be personal information.
        await audit('action', { action, chars: text.length, field: clip(focused?.label, 80) || null });
        return done(`typed into “${clip(focused?.label, 60) || 'the page'}”`);
      }
      case 'key': {
        const combo = String(input.text ?? '');
        if (!combo) return fail('No key given.');
        const focused = await driver.focusedElement();
        const gate = await passGate(classifyKey(combo, focused), action);
        if (!gate.ok) return fail(gate.text);
        const repeat = Math.min(50, Math.max(1, Number(input.repeat) || 1));
        await driver.key(combo, repeat);
        await audit('action', { action, key: clip(combo, 40), repeat });
        return done(`pressed ${clip(combo, 40)}`);
      }
      default:
        return fail(`Unsupported action "${clip(action, 40)}".`);
    }
  };

  /** Custom tools: open_url, request_approval, needs_you, finish. */
  const runCustom = async (block: ContentBlock): Promise<{ text: string; isError: boolean; outcome?: AgentOutcome }> => {
    const input = (block.input ?? {}) as Record<string, any>;
    switch (block.name) {
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
        await driver.navigate(parsed.toString());
        await audit('navigate', { host: parsed.hostname });
        await store.updateTask(task.id, { current_url: clip(await driver.currentUrl(), 2000), last_action: `opened ${parsed.hostname}` });
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
        const shot = await driver.screenshot('jpeg');
        const { token, tokenHash } = newApprovalToken();
        const expiresAt = run.now() + settings.approvalTtlMs;
        const kind = kindForApproval(buttonLabel);
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
          unverified: fields.filter((f) => !f.verified).length,
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
        await audit('approval_granted', { approvalId: approval.id }, 'system');
        return {
          text: `Approved. You may click “${buttonLabel}” once now. Any other submit-type click needs a new approval.`,
          isError: false,
        };
      }
      case 'needs_you': {
        const reason = (['login', 'two_factor', 'captcha', 'other'].includes(input.reason) ? input.reason : 'other') as NeedsYouReason;
        const message = clip(input.message, 400) || 'Please take over in the live view, then press Resume.';
        await pauseForPerson(reason, message);
        return { text: 'The person pressed Resume. Take a screenshot and continue.', isError: false };
      }
      case 'finish': {
        const summary = clip(input.summary, 4000) || 'Done.';
        return { text: 'Finished.', isError: false, outcome: { status: 'succeeded', summary, submitted: Boolean(input.submitted) } };
      }
      default:
        return { text: `Unknown tool "${clip(block.name, 40)}".`, isError: true };
    }
  };

  const tools = [COMPUTER_TOOLSET, ...COMPUTER_CUSTOM_TOOLS];
  const system = [{ type: 'text' as const, text: COMPUTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }];

  try {
    await heartbeat({ current_url: clip(await driver.currentUrl(), 2000) || null });
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          textBlock(taskPrompt({ instructions: task.instructions, startUrl: task.start_url, projection: task.job_projection ?? [] })),
          await screenshotBlock(),
        ],
      },
    ];

    while (step < task.max_steps) {
      const fresh = await store.getTask(null, task.id);
      if (!fresh || fresh.cancel_requested_at) return { status: 'canceled', summary: 'Canceled.' };
      if (fresh.human_control_by) await waitForControlRelease();
      if (await run.isPaused()) {
        return { status: 'failed', error: 'Stopped: AI is paused for this account until the allowance resets or credits are added.' };
      }
      const spent = cost + run.browserCostNanos();
      if (spent >= task.budget_nanos) {
        await audit('budget_reached', { spentNanos: spent, budgetNanos: task.budget_nanos }, 'system');
        return { status: 'failed', error: 'Stopped: this task reached its spending cap. Nothing more was done.' };
      }

      // Captchas and one-time-code pages pause before the model acts on them.
      const signals = await driver.pageSignals().catch(() => null);
      if (signals?.hasCaptcha && captchaAckUrl !== signals.url) {
        captchaAckUrl = signals.url;
        await pauseForPerson('captcha', 'This page has a captcha. Computer never solves captchas. Please complete it in the live view, then press Resume.');
        messages.push({ role: 'user', content: [textBlock('The person handled the captcha and pressed Resume.'), await screenshotBlock()] });
        pruneScreenshots(messages, settings.keepScreenshots);
        continue;
      }

      step += 1;
      const response = await model.create({ model: task.model_id, system, tools, messages, max_tokens: 2048 });
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
        return { status: 'succeeded', summary: clip(text, 4000) || 'Done.' };
      }

      const results: ContentBlock[] = [];
      let failed = false;
      let finished: AgentOutcome | null = null;
      let lastMemberIndex = -1;
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
          else if (memberAction(block) !== 'screenshot') lastMemberIndex = results.length - 1;
        } else {
          const out = await runCustom(block);
          results.push({ ...base, content: out.text, ...(out.isError ? { is_error: true } : {}) });
          if (out.outcome) finished = out.outcome;
        }
      }
      if (finished) {
        await audit('finished', { submitted: Boolean(finished.submitted) });
        return finished;
      }
      // Show the page after the last action so the model sees what changed.
      if (lastMemberIndex >= 0) {
        const r = results[lastMemberIndex];
        r.content = [...(r.content as ContentBlock[]), await screenshotBlock()];
      }
      messages.push({ role: 'user', content: results });
      pruneScreenshots(messages, settings.keepScreenshots);
      await store.updateTask(task.id, { current_url: clip(await driver.currentUrl(), 2000) || null });
    }
    await audit('step_cap', { steps: step }, 'system');
    return { status: 'failed', error: `Stopped after ${task.max_steps} steps without finishing. Nothing was submitted without your approval.` };
  } catch (err) {
    if (err instanceof Halt) return err.outcome;
    throw err;
  } finally {
    await store.updateTask(task.id, { step_count: step, cost_nanos: cost }).catch(() => undefined);
  }
}
