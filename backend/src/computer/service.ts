/**
 * Entry points Chat and the /api/chat-computer routes share. Every function here
 * takes an org id that the caller already proved (requireOrgContext, or the
 * Ask tool's org access), and every lookup is filtered by it.
 */
import { parseTaskResult } from './result.js';
import type { JobFileAskContext } from '../shared/jobFileAsk.js';
import { computerSettings, NOT_SET_UP_MESSAGE } from './config.js';
import { projectJobForComputer } from './projection.js';
import { computerProvider } from './providers/index.js';
import type { ComputerAuditRow, ComputerApprovalRow, ComputerTaskRow } from './store.js';
import { assertComputerAiAllowed, computerStore, kickComputerWorker } from './worker.js';
import { OPEN_TASK_STATUSES } from './types.js';

export class ComputerServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'not_set_up' | 'not_allowed' | 'bad_request' | 'ai_paused' | 'unavailable' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'ComputerServiceError';
  }
}

export function computerStatus(): { configured: boolean; provider: string; message: string | null } {
  const provider = computerProvider();
  const configured = provider.configured() && Boolean(computerStore());
  return { configured, provider: provider.id, message: configured ? null : NOT_SET_UP_MESSAGE };
}

export function cleanUrl(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

/** The first web address in the person's message, if any. */
export function startUrlFromText(text: string): string | null {
  const explicit = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (explicit) return cleanUrl(explicit[0].replace(/[.,;:!?]+$/, ''));
  for (const m of text.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,12}(?:\/[^\s<>"')]*)?/gi)) {
    const candidate = m[0].replace(/[.,;:!?]+$/, '');
    if (/\.(pdf|docx?|xlsx?|csv|txt|jpe?g|png|gif|heic|webp|mp4|mov|zip)$/i.test(candidate.split('/')[0])) continue;
    return cleanUrl(candidate);
  }
  return null;
}

export async function startComputerTask(input: {
  orgId: string;
  userId: string | null;
  jobId: string | null;
  instructions: string;
  startUrl?: string | null;
  file?: JobFileAskContext | null;
  address?: string | null;
  canManage?: boolean;
}): Promise<ComputerTaskRow> {
  const status = computerStatus();
  if (!status.configured) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const instructions = String(input.instructions ?? '').trim().slice(0, 4000);
  if (!instructions) throw new ComputerServiceError('Tell Computer what to do on the website.', 'bad_request');
  try {
    await assertComputerAiAllowed(input.orgId, Boolean(input.canManage));
  } catch (err) {
    throw new ComputerServiceError(err instanceof Error ? err.message : 'AI is paused for this account.', 'ai_paused');
  }
  const settings = computerSettings();
  const task = await store.insertTask({
    org_id: input.orgId,
    job_id: input.jobId,
    created_by: input.userId,
    instructions,
    start_url: cleanUrl(input.startUrl) ?? startUrlFromText(instructions),
    job_projection: projectJobForComputer(input.file ?? null, input.address ?? null),
    model_id: settings.model,
    max_steps: settings.maxSteps,
    budget_nanos: settings.budgetNanos,
  });
  await store
    .appendAudit({
      org_id: task.org_id,
      task_id: task.id,
      job_id: task.job_id,
      actor_kind: 'user',
      actor_user_id: input.userId,
      event: 'task_queued',
      detail: { fields: task.job_projection.length, hasStartUrl: Boolean(task.start_url) },
    })
    .catch(() => undefined);
  kickComputerWorker();
  return task;
}

/* ------------------------------------------------------------- task views -- */

export interface ComputerTaskView {
  id: string;
  jobId: string | null;
  status: ComputerTaskRow['status'];
  statusDetail: string | null;
  instructions: string;
  startUrl: string | null;
  needsYou: ComputerTaskRow['needs_you'];
  humanControl: boolean;
  youHaveControl: boolean;
  stepCount: number;
  maxSteps: number;
  lastAction: string | null;
  currentUrl: string | null;
  /** Plain note for the person (legacy rows: the whole summary). */
  resultSummary: string | null;
  /** Structured result from finish, when the agent gave one. */
  result: { title: string | null; fields: Array<{ label: string; value: string }>; notes: string | null } | null;
  /** True only when an approved submit-type click went through (from the audit, not the model). */
  submitted: boolean;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canWatch: boolean;
  jobFields: Array<{ label: string; value: string; source: string }>;
  approval: null | {
    id: string;
    status: ComputerApprovalRow['status'];
    actionKind: ComputerApprovalRow['action_kind'];
    buttonLabel: string;
    summary: string;
    pageUrl: string | null;
    fields: ComputerApprovalRow['fields'];
    screenshot: string | null;
    requestedAt: string;
    expiresAt: string;
  };
  events: Array<{ id: number; event: string; actor: string; at: string; detail: Record<string, unknown> }>;
}

const SAFE_DETAIL_KEYS = ['action', 'kind', 'label', 'reason', 'host', 'why', 'status', 'submitted', 'field', 'chars', 'key', 'mode', 'target'];

function safeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SAFE_DETAIL_KEYS) if (k in detail) out[k] = detail[k];
  return out;
}

export function taskView(
  task: ComputerTaskRow,
  approval: ComputerApprovalRow | null,
  events: ComputerAuditRow[],
  viewerId: string | null,
): ComputerTaskView {
  const open = (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
  const showApproval = approval && (approval.status === 'pending' || (approval.status === 'approved' && open));
  const structured = parseTaskResult(task.result_summary);
  return {
    id: task.id,
    jobId: task.job_id,
    status: task.status,
    statusDetail: task.status_detail,
    instructions: task.instructions,
    startUrl: task.start_url,
    needsYou: task.status === 'needs_you' ? task.needs_you : null,
    humanControl: Boolean(task.human_control_by),
    youHaveControl: Boolean(viewerId && task.human_control_by === viewerId),
    stepCount: task.step_count,
    maxSteps: task.max_steps,
    lastAction: task.last_action,
    currentUrl: task.current_url,
    resultSummary: structured ? structured.notes : task.result_summary,
    result: structured
      ? {
          title: structured.title,
          // The agent forgot to list fields but asked for approval: show what it asked to submit.
          fields: structured.fields.length
            ? structured.fields
            : (approval?.fields ?? []).map((f) => ({ label: f.label, value: f.value })),
          notes: structured.notes,
        }
      : null,
    submitted: approval?.status === 'consumed' || events.some((e) => e.event === 'approval_used'),
    error: task.error,
    createdAt: task.created_at,
    startedAt: task.started_at,
    finishedAt: task.finished_at,
    canWatch: Boolean(task.session_id) && task.status !== 'queued' && open,
    jobFields: (task.job_projection ?? []).map((f) => ({ label: f.label, value: f.value, source: f.source })),
    approval: showApproval
      ? {
          id: approval.id,
          status: approval.status,
          actionKind: approval.action_kind,
          buttonLabel: approval.button_label,
          summary: approval.summary,
          pageUrl: approval.page_url,
          fields: approval.fields ?? [],
          screenshot: approval.screenshot_jpeg_b64 ? `data:image/jpeg;base64,${approval.screenshot_jpeg_b64}` : null,
          requestedAt: approval.requested_at,
          expiresAt: approval.expires_at,
        }
      : null,
    events: events.map((e) => ({ id: e.id, event: e.event, actor: e.actor_kind, at: e.created_at, detail: safeDetail(e.detail ?? {}) })),
  };
}

export async function loadTaskView(orgId: string, taskId: string, viewerId: string | null): Promise<ComputerTaskView> {
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const task = await store.getTask(orgId, taskId);
  if (!task) throw new ComputerServiceError('Task not found', 'not_found');
  const [approval, events] = await Promise.all([store.latestApproval(task.id), store.listAudit(task.id, 40)]);
  return taskView(task, approval, events, viewerId);
}

async function audit(orgId: string, task: ComputerTaskRow, userId: string | null, event: string, detail: Record<string, unknown> = {}) {
  const store = computerStore();
  await store
    ?.appendAudit({ org_id: orgId, task_id: task.id, session_id: task.session_id, job_id: task.job_id, actor_kind: 'user', actor_user_id: userId, event, detail })
    .catch(() => undefined);
}

/**
 * Mint a live-view link for one viewer. 'control' also hands that viewer the
 * mouse: the agent pauses at its next step until they hand it back.
 * The URL is returned to the caller only; it is never stored or logged.
 */
export async function mintLiveView(orgId: string, taskId: string, userId: string, mode: 'watch' | 'control') {
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const task = await store.getTask(orgId, taskId);
  if (!task) throw new ComputerServiceError('Task not found', 'not_found');
  if (!(['running', 'awaiting_approval', 'needs_you'] as string[]).includes(task.status) || !task.session_id) {
    throw new ComputerServiceError('The browser is not running for this task.', 'conflict');
  }
  const session = await store.getSession(task.session_id);
  if (!session?.provider_session_id || session.status !== 'active') {
    throw new ComputerServiceError('The browser is not running for this task.', 'conflict');
  }
  const provider = computerProvider();
  if (!provider.configured()) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const link = await provider.liveViewUrl(session.provider_session_id, { expiresInSec: computerSettings().liveViewTtlSec });
  if (mode === 'control' && task.human_control_by !== userId) {
    await store.updateTask(task.id, { human_control_by: userId, human_control_since: new Date().toISOString() });
    await audit(orgId, task, userId, 'took_control', { mode });
  } else {
    await audit(orgId, task, userId, 'live_view_opened', { mode });
  }
  return { url: link.url, expiresAt: link.expiresAt, mode };
}

export async function handBackControl(orgId: string, taskId: string, userId: string) {
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const task = await store.getTask(orgId, taskId);
  if (!task) throw new ComputerServiceError('Task not found', 'not_found');
  await store.updateTask(task.id, { human_control_by: null, human_control_since: null });
  await audit(orgId, task, userId, 'handed_back', {});
}

export async function resumeTask(orgId: string, taskId: string, userId: string) {
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const task = await store.getTask(orgId, taskId);
  if (!task) throw new ComputerServiceError('Task not found', 'not_found');
  if (task.status !== 'needs_you') throw new ComputerServiceError('This task is not waiting for you.', 'conflict');
  await store.updateTask(task.id, {
    resume_requested_at: new Date().toISOString(),
    human_control_by: null,
    human_control_since: null,
  });
  await audit(orgId, task, userId, 'resume_requested', {});
}

export async function cancelTask(orgId: string, taskId: string, userId: string) {
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const task = await store.getTask(orgId, taskId);
  if (!task) throw new ComputerServiceError('Task not found', 'not_found');
  const at = new Date().toISOString();
  // A queued task never started: cancel it outright.
  const fromQueue = await store.transitionTask(task.id, ['queued'], {
    status: 'canceled',
    cancel_requested_at: at,
    finished_at: at,
    result_summary: 'Canceled before it started.',
  });
  if (!fromQueue) await store.updateTask(task.id, { cancel_requested_at: at });
  const approval = await store.latestApproval(task.id);
  if (approval && approval.status === 'pending') await store.decideApproval(approval.id, 'canceled', userId);
  await audit(orgId, task, userId, 'cancel_requested', {});
}

export async function decideApproval(orgId: string, approvalId: string, userId: string, decision: 'approve' | 'cancel') {
  const store = computerStore();
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const approval = await store.getApproval(orgId, approvalId);
  if (!approval) throw new ComputerServiceError('Approval not found', 'not_found');
  const task = await store.getTask(orgId, approval.task_id);
  if (!task) throw new ComputerServiceError('Approval not found', 'not_found');
  const ok = await store.decideApproval(approval.id, decision === 'approve' ? 'approved' : 'canceled', userId);
  if (!ok) throw new ComputerServiceError('This approval is no longer open.', 'conflict');
  await audit(orgId, task, userId, decision === 'approve' ? 'approved' : 'approval_canceled', {
    kind: approval.action_kind,
    label: approval.button_label,
  });
  return { ok: true };
}
