/**
 * Computer: Chat's browser agent. Types for /api/chat-computer and the helpers the
 * task card uses. Names are ComputerTask* so they never collide with the
 * retired computer-use types elsewhere in api.ts.
 */

export type ComputerTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'needs_you'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type ComputerActionKind = 'submit' | 'send' | 'pay' | 'delete' | 'sign' | 'accept_terms' | 'upload';

export interface ComputerApprovalField {
  label: string;
  value: string;
  source: string;
  verified: boolean;
}

export interface ComputerTaskApproval {
  id: string;
  status: 'pending' | 'approved' | 'canceled' | 'expired' | 'consumed';
  actionKind: ComputerActionKind;
  buttonLabel: string;
  summary: string;
  pageUrl: string | null;
  fields: ComputerApprovalField[];
  /** data: URL of the page when approval was asked. */
  screenshot: string | null;
  requestedAt: string;
  expiresAt: string;
}

export interface ComputerTaskEvent {
  id: number;
  event: string;
  actor: string;
  at: string;
  detail: Record<string, unknown>;
}

export interface ComputerTaskView {
  id: string;
  jobId: string | null;
  status: ComputerTaskStatus;
  statusDetail: string | null;
  instructions: string;
  startUrl: string | null;
  needsYou: { reason: 'login' | 'two_factor' | 'captcha' | 'other'; message: string; since: string } | null;
  humanControl: boolean;
  youHaveControl: boolean;
  stepCount: number;
  maxSteps: number;
  lastAction: string | null;
  currentUrl: string | null;
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canWatch: boolean;
  jobFields: Array<{ label: string; value: string; source: string }>;
  approval: ComputerTaskApproval | null;
  events: ComputerTaskEvent[];
}

export interface ComputerLiveLink {
  url: string;
  expiresAt: string;
  mode: 'watch' | 'control';
}

export const COMPUTER_ACTIVE: readonly ComputerTaskStatus[] = ['queued', 'running', 'awaiting_approval', 'needs_you'];

export function computerTaskIsActive(status: ComputerTaskStatus): boolean {
  return COMPUTER_ACTIVE.includes(status);
}

/** Task id from an Ask action path (`computer-task:<uuid>`), or the special states. */
export function computerTaskRef(path: string | null | undefined):
  | { kind: 'task'; id: string }
  | { kind: 'not_set_up' }
  | { kind: 'error' }
  | null {
  const raw = String(path ?? '').trim();
  if (!raw.startsWith('computer-task:')) return null;
  const rest = raw.slice('computer-task:'.length);
  if (rest === 'not-set-up') return { kind: 'not_set_up' };
  if (/^[0-9a-f-]{36}$/i.test(rest)) return { kind: 'task', id: rest };
  return { kind: 'error' };
}

export const COMPUTER_STATUS_LABEL: Record<ComputerTaskStatus, string> = {
  queued: 'Waiting to start',
  running: 'Working',
  awaiting_approval: 'Needs your approval',
  needs_you: 'Needs you',
  succeeded: 'Done',
  failed: 'Stopped',
  canceled: 'Canceled',
};

export const COMPUTER_ACTION_LABEL: Record<ComputerActionKind, string> = {
  submit: 'Submit',
  send: 'Send',
  pay: 'Pay',
  delete: 'Delete',
  sign: 'Sign',
  accept_terms: 'Accept terms',
  upload: 'Upload',
};

export const NEEDS_YOU_TITLE: Record<NonNullable<ComputerTaskView['needsYou']>['reason'], string> = {
  login: 'Sign in to continue',
  two_factor: 'Enter the verification code',
  captcha: 'Complete the captcha',
  other: 'Your turn',
};

const EVENT_LABEL: Record<string, string> = {
  task_queued: 'Queued',
  task_started: 'Started a browser',
  session_started: 'Browser ready',
  navigate: 'Opened a page',
  action: 'Acted on the page',
  blocked: 'Blocked an action',
  approval_requested: 'Asked for approval',
  approved: 'You approved',
  approval_used: 'Clicked the approved button',
  approval_canceled: 'You canceled the approval',
  needs_you: 'Paused for you',
  resume_requested: 'You pressed Resume',
  resumed: 'Resumed',
  took_control: 'You took control',
  handed_back: 'You handed back control',
  live_view_opened: 'Live view opened',
  finished: 'Finished',
  task_finished: 'Task closed',
  session_ended: 'Browser closed',
  cancel_requested: 'Cancel requested',
  budget_reached: 'Reached the spending cap',
  step_cap: 'Reached the step limit',
};

export function computerEventLabel(event: ComputerTaskEvent): string {
  const base = EVENT_LABEL[event.event] ?? event.event.replace(/_/g, ' ');
  const d = event.detail ?? {};
  if (event.event === 'action') {
    const action = String(d.action ?? '').replace(/_/g, ' ');
    const field = d.field ? ` in “${String(d.field)}”` : '';
    const target = d.target && typeof d.target === 'object' && (d.target as { label?: string }).label
      ? ` “${(d.target as { label?: string }).label}”`
      : '';
    if (action === 'type') return `Typed${field}`;
    if (action === 'key') return `Pressed ${String(d.key ?? 'a key')}`;
    return `${action.charAt(0).toUpperCase()}${action.slice(1)}${target}`;
  }
  if (event.event === 'navigate' && d.host) return `Opened ${String(d.host)}`;
  if (event.event === 'blocked' && d.label) return `Held “${String(d.label)}” for your approval`;
  if (event.event === 'blocked' && d.why === 'outside_task') return `Refused to leave the task (${String(d.host ?? 'another site')})`;
  if (event.event === 'needs_you' && d.reason) return `Paused for you (${String(d.reason).replace('_', ' ')})`;
  return base;
}

/**
 * Only frame live views from the browser service (and the demo's inline page).
 * The nginx CSP frame-src allows the same host.
 */
export function isAllowedLiveViewUrl(url: string, demo = Boolean(import.meta.env.VITE_DEMO)): boolean {
  if (demo && url.startsWith('data:text/html')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'www.browserbase.com';
  } catch {
    return false;
  }
}
