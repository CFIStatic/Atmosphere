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
  needsYou: {
    reason: 'login' | 'two_factor' | 'number_match' | 'captcha' | 'clarification' | 'stuck' | 'other';
    message: string;
    since: string;
    /** data: URL when the server captured the page at pause time. */
    screenshot?: string | null;
  } | null;
  humanControl: boolean;
  youHaveControl: boolean;
  stepCount: number;
  maxSteps: number;
  lastAction: string | null;
  currentUrl: string | null;
  /** Plain note for the person (older tasks: the whole summary). */
  resultSummary: string | null;
  /** What Computer filled in, when it reported it. */
  result: { title: string | null; fields: Array<{ label: string; value: string }>; notes: string | null } | null;
  /** True only when an approved submit-type click went through. */
  submitted: boolean;
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
  | { kind: 'need_login' }
  | { kind: 'draft_preview' }
  | { kind: 'materials_list' }
  | { kind: 'sms_approval' }
  | { kind: 'error' }
  | null {
  const raw = String(path ?? '').trim();
  // Ask offerLogins returns bare `logins` (not computer-task:…).
  if (raw === 'logins') return { kind: 'need_login' };
  if (!raw.startsWith('computer-task:')) return null;
  const rest = raw.slice('computer-task:'.length);
  if (rest === 'not-set-up') return { kind: 'not_set_up' };
  if (rest === 'need-login' || rest === 'logins') return { kind: 'need_login' };
  if (rest === 'draft-preview') return { kind: 'draft_preview' };
  if (rest === 'materials-list') return { kind: 'materials_list' };
  if (rest === 'sms-approval') return { kind: 'sms_approval' };
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
  pay: 'Place order / pay',
  delete: 'Delete',
  sign: 'Sign',
  accept_terms: 'Accept terms',
  upload: 'Upload',
};

export const NEEDS_YOU_TITLE: Record<NonNullable<ComputerTaskView['needsYou']>['reason'], string> = {
  login: 'Sign in to continue',
  two_factor: 'Enter the verification code',
  number_match: 'Approve on your phone',
  captcha: 'Complete the captcha',
  clarification: 'Quick question',
  stuck: 'Stuck — take over',
  other: 'Your turn',
};

/** Plain-word lines for the Steps list. Housekeeping events are left out. */
const EVENT_LABEL: Record<string, string> = {
  task_started: 'Opened a browser',
  navigate: 'Opened a page',
  action: 'Worked on the page',
  blocked: 'Held back an action',
  approval_requested: 'Asked for your approval',
  approval_granted: 'You approved',
  approved: 'You approved',
  approval_used: 'Clicked the approved button',
  approval_canceled: 'You canceled',
  approval_declined: 'You declined',
  approval_superseded: 'You took over before approving',
  needs_you: 'Paused for you',
  auto_sign_in: 'Signed in with the saved login',
  resumed: 'Carried on',
  took_control: 'You took control',
  handed_back: 'You handed back',
  budget_reached: 'Stopped at the spending cap',
  step_cap: 'Stopped at the step limit',
  finished: 'Finished',
};

/** Events that are bookkeeping, not steps a person cares about. */
const HIDDEN_EVENTS = new Set([
  'task_queued',
  'context_created',
  'session_started',
  'session_ended',
  'live_view_opened',
  'task_finished',
  'resume_requested',
  'cancel_requested',
]);

const NEEDS_YOU_STEP: Record<string, string> = {
  login: 'Paused for you to sign in',
  two_factor: 'Paused for you to enter a code',
  number_match: 'Paused for you to approve on your phone',
  captcha: 'Paused for you to complete a captcha',
  clarification: 'Asked you a question',
  stuck: 'Paused because Computer was stuck',
  other: 'Paused for you',
};

/** A page's field label without the trailing colon ("Telephone:" → "Telephone"). */
export function cleanFieldLabel(label: unknown): string {
  return String(label ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[:：*]+$/, '');
}

function clickTarget(event: ComputerTaskEvent): string {
  const t = event.detail?.target;
  return t && typeof t === 'object' ? cleanFieldLabel((t as { label?: string }).label) : '';
}

export function computerEventLabel(event: ComputerTaskEvent): string {
  const base = EVENT_LABEL[event.event] ?? 'Worked on the page';
  const d = event.detail ?? {};
  if (event.event === 'action') {
    const action = String(d.action ?? '');
    const field = cleanFieldLabel(d.field);
    const target = clickTarget(event);
    if (action === 'type') return field ? `Typed in “${field}”` : 'Typed on the page';
    if (action === 'key') return `Pressed ${String(d.key ?? 'a key')}`;
    if (action === 'fill_fields') {
      const filled = Number(d.filled ?? 0);
      const total = Number(d.fields ?? filled);
      return filled === total ? `Filled in ${filled} field${filled === 1 ? '' : 's'}` : `Filled in ${filled} of ${total} fields`;
    }
    if (action.endsWith('click')) return target ? `Clicked “${target}”` : 'Clicked on the page';
    return base;
  }
  if (event.event === 'navigate' && d.host) return `Opened ${String(d.host)}`;
  if (event.event === 'blocked' && d.why === 'outside_task') return `Stayed on the task instead of opening ${String(d.host ?? 'another site')}`;
  if (event.event === 'blocked' && d.why === 'placement') {
    const field = cleanFieldLabel(d.field);
    return field ? `Left “${field}” for the right value instead of guessing` : 'Did not type a value that did not fit the field';
  }
  if (event.event === 'blocked' && d.label) return `Held “${String(d.label)}” for your approval`;
  if (event.event === 'approval_requested' && d.label) return `Asked you before clicking “${String(d.label)}”`;
  if (event.event === 'auto_sign_in') {
    const host = d.host ? String(d.host) : 'the site';
    const outcome = String(d.outcome ?? '');
    if (outcome === 'signed_in' || outcome === 'already_signed_in') return `Signed in to ${host} with the saved login`;
    if (outcome === 'two_factor') return `Signed in to ${host} with the saved login; it asked for a code`;
    if (outcome === 'number_match') return `Signed in to ${host}; approve the number on your phone`;
    if (outcome === 'captcha') return `Used the saved login for ${host}; it showed a captcha`;
    if (outcome === 'failed') return `The saved login for ${host} didn’t work`;
    return `Tried the saved login for ${host}`;
  }
  if (event.event === 'needs_you') return NEEDS_YOU_STEP[String(d.reason ?? 'other')] ?? NEEDS_YOU_STEP.other;
  if (event.event === 'finished') return d.submitted ? 'Finished and submitted' : 'Finished';
  return base;
}

/** The steps worth showing a person, in order, in plain words. */
export function computerStepLines(events: readonly ComputerTaskEvent[]): Array<{ id: number; text: string }> {
  const shown = events.filter((e) => !HIDDEN_EVENTS.has(e.event));
  const lines: Array<{ id: number; text: string }> = [];
  for (let i = 0; i < shown.length; i += 1) {
    const e = shown[i];
    const next = shown[i + 1];
    // Click a field, then type in it: one step, "Filled in “Telephone”".
    if (
      e.event === 'action' &&
      String(e.detail?.action ?? '').endsWith('click') &&
      next?.event === 'action' &&
      next.detail?.action === 'type' &&
      clickTarget(e) &&
      clickTarget(e) === cleanFieldLabel(next.detail?.field)
    ) {
      lines.push({ id: e.id, text: `Filled in “${clickTarget(e)}”` });
      i += 1;
      continue;
    }
    lines.push({ id: e.id, text: computerEventLabel(e) });
  }
  return lines;
}

/** The status pill on the task card. */
export type ComputerPill = 'Working' | 'Needs you' | 'Waiting for approval' | 'Done, not submitted' | 'Submitted' | 'Failed' | 'Stopped';

export function computerPill(task: Pick<ComputerTaskView, 'status' | 'submitted'>): ComputerPill {
  switch (task.status) {
    case 'queued':
    case 'running':
      return 'Working';
    case 'needs_you':
      return 'Needs you';
    case 'awaiting_approval':
      return 'Waiting for approval';
    case 'succeeded':
      return task.submitted ? 'Submitted' : 'Done, not submitted';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return task.submitted ? 'Submitted' : 'Stopped';
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Header words while paused; the Needs-you card below says what to do. */
const NEEDS_YOU_SHORT: Record<NonNullable<ComputerTaskView['needsYou']>['reason'], string> = {
  login: 'sign-in needed',
  two_factor: 'code needed',
  number_match: 'approve on phone',
  captcha: 'captcha needed',
  clarification: 'question for you',
  stuck: 'stuck',
  other: 'paused',
};

/** "httpbin.org: form filled": the site, then a short title for where things stand. */
export function computerCardTitle(task: ComputerTaskView): string {
  const site = hostOf(task.currentUrl) ?? hostOf(task.startUrl) ?? hostOf(task.approval?.pageUrl ?? null);
  let what: string;
  switch (task.status) {
    case 'queued':
      what = 'starting';
      break;
    case 'running':
      what = 'in progress';
      break;
    case 'needs_you':
      what = NEEDS_YOU_SHORT[task.needsYou?.reason ?? 'other'];
      break;
    case 'awaiting_approval':
      what = task.approval ? `ready to ${task.approval.buttonLabel.toLowerCase()}` : 'ready for your approval';
      break;
    case 'succeeded': {
      const t = task.result?.title?.trim();
      what = t ? t.charAt(0).toLowerCase() + t.slice(1) : task.submitted ? 'submitted' : task.result?.fields.length ? 'form filled' : 'done';
      break;
    }
    case 'failed':
      what = "didn't finish";
      break;
    case 'canceled':
      what = 'stopped';
      break;
  }
  return site ? `${site}: ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

/** The same-origin path that serves a Windows desktop live view. */
export const DESKTOP_LIVE_PREFIX = '/api/chat-computer/desktop-live/';

/**
 * Only frame live views from the browser service, the same-origin desktop
 * live view, or the demo's inline page. The nginx CSP frame-src allows 'self'
 * and the browser service host.
 */
export function isAllowedLiveViewUrl(url: string, demo = Boolean(import.meta.env.VITE_DEMO)): boolean {
  if (demo && url.startsWith('data:text/html')) return true;
  // A desktop live view is a same-origin path, not an absolute URL.
  if (url.startsWith(DESKTOP_LIVE_PREFIX)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'www.browserbase.com';
  } catch {
    return false;
  }
}

// ---- Logins: sites the company signs in to ahead of time ----

export type ComputerVerifyLoginStatus =
  | 'signed_in'
  | 'needs_sign_in'
  | 'captcha'
  | 'two_factor'
  | 'number_match'
  | 'unclear';

export interface ComputerVerifyLoginResult {
  status: ComputerVerifyLoginStatus;
  message: string;
  host: string;
  label: string;
  url: string | null;
}

export interface ComputerLogin {
  id: string;
  label: string;
  url: string;
  host: string;
  addedBy: string | null;
  addedAt: string;
  lastSignedInAt: string | null;
  lastSignedInBy: string | null;
  /** True when Remove can also sign Computer out (we recorded which cookies). */
  canClearCookies: boolean;
  /** A saved username and password, if any. The password itself never comes back. */
  credential: ComputerSavedCredential | null;
}

export interface ComputerSavedCredential {
  saved: true;
  /** Only sent to admins. */
  username: string | null;
  loginUrl: string | null;
  status: 'ok' | 'needs_attention';
  attentionReason: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ComputerCredentialInput {
  username: string;
  password: string;
  loginUrl?: string | null;
}

export type ComputerAutoSignInOutcome =
  | 'signed_in'
  | 'already_signed_in'
  | 'two_factor'
  | 'captcha'
  | 'failed'
  | 'incomplete'
  | 'unavailable';

export interface ComputerSignIn {
  sessionId: string;
  label: string;
  url: string;
  host: string;
  loginId: string | null;
  startedAt: string;
  startedBy: string | null;
  startedByYou: boolean;
  expiresAt: string;
  /** Set when Computer typed a saved password into the site for this sign-in. */
  autoSignIn?: { outcome: ComputerAutoSignInOutcome; message: string } | null;
}

export interface ComputerLoginsState {
  configured: boolean;
  message: string | null;
  logins: ComputerLogin[];
  signingIn: ComputerSignIn | null;
  busy: string | null;
  /** Saving passwords: on only when the server has its encryption key; managed by Global Admins. */
  passwords?: { enabled: boolean; message: string | null; canManage: boolean };
}

export interface ComputerRemoveLoginResult {
  removed: true;
  cookiesCleared: boolean;
  message: string;
}

/** One site in the "Add a login" catalog (served by the backend from its site catalog data). */
export interface LoginCatalogEntry {
  id: string;
  name: string;
  category: string;
  signInUrl: string;
  host: string;
  aliases: string[];
  /** 'likely' → the site usually asks for a code at sign-in. */
  twoStep: 'likely' | 'sometimes' | 'rare';
  /** Company accounts often sign in through Google, Microsoft or another single sign-on. */
  sso: boolean;
  logo: { text: string; color: string };
  termsNote: string | null;
  practice: string[];
  /** How Computer signs in, in plain words (every catalog site is ready right after saving). */
  signInSteps: string;
}

export interface LoginCatalog {
  /** terms: extra words that find the category ("supply" finds Suppliers). */
  categories: Array<{ id: string; label: string; terms?: string[] }>;
  sites: LoginCatalogEntry[];
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** Sites matching a search (name, aliases, host or category label), grouped in catalog category order. */
export function groupLoginCatalog(
  catalog: LoginCatalog,
  query: string,
): Array<{ id: string; label: string; sites: LoginCatalogEntry[] }> {
  const q = fold(query);
  const labels = new Map(catalog.categories.map((c) => [c.id, [c.label, ...(c.terms ?? [])]]));
  const match = (s: LoginCatalogEntry) =>
    !q ||
    [s.name, s.host, ...(labels.get(s.category) ?? []), ...s.aliases].some((t) => fold(t).includes(q));
  return catalog.categories
    .map((c) => ({ id: c.id, label: c.label, sites: catalog.sites.filter((s) => s.category === c.id && match(s)) }))
    .filter((g) => g.sites.length > 0);
}

/** Hostname without "www." (lowercase), or '' when it is not a web address. */
function bareHost(hostOrUrl: string | null | undefined): string {
  const text = String(hostOrUrl ?? '').trim().toLowerCase();
  if (!text) return '';
  try {
    const host = /^[a-z]+:\/\//.test(text) ? new URL(text).hostname : text.split(/[/?#]/)[0]!;
    return host.replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A sign-in address compared loosely: host without "www.", path without a trailing slash, query kept. */
function sameUrlKey(url: string | null | undefined): string {
  const text = String(url ?? '').trim();
  if (!text) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return `${bareHost(u.hostname)}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return '';
  }
}

/**
 * Which catalog sites already have a saved login, and which saved logins match no catalog site.
 *
 * Saved logins don't store a catalog id, so a login matches a site by, in order:
 * 1. its address (or saved sign-in page) being the site's sign-in address — what picking the
 *    site saves. This tells apart sites that share a sign-in host (Google Calendar, Drive and
 *    Business Profile all sign in on accounts.google.com).
 * 2. its host (without "www.") being the site's own host, e.g. a custom "outlook.office.com".
 *    Only the site's own host counts, never a shared sign-in host, so a custom
 *    accounts.google.com login doesn't check a Google site.
 * Several matches are narrowed by the login's name; still ambiguous means no match. A site
 * holds one login; any other login for it is listed with the unmatched ones so it can still
 * be managed.
 */
export function matchSavedLogins(
  catalog: LoginCatalog | null,
  logins: ComputerLogin[],
): { bySite: Map<string, ComputerLogin>; unmatched: ComputerLogin[] } {
  const bySite = new Map<string, ComputerLogin>();
  const unmatched: ComputerLogin[] = [];
  const sites = catalog?.sites ?? [];
  for (const login of logins) {
    const urls = new Set([sameUrlKey(login.url), sameUrlKey(login.credential?.loginUrl)].filter(Boolean));
    const hosts = new Set([bareHost(login.host), bareHost(login.url)].filter(Boolean));
    let candidates = sites.filter((s) => urls.has(sameUrlKey(s.signInUrl)));
    if (candidates.length === 0) candidates = sites.filter((s) => hosts.has(bareHost(s.host)));
    if (candidates.length > 1) {
      const name = fold(login.label);
      candidates = candidates.filter((s) => fold(s.name) === name);
    }
    const site = candidates.length === 1 ? candidates[0]! : null;
    if (site && !bySite.has(site.id)) bySite.set(site.id, login);
    else unmatched.push(login);
  }
  return { bySite, unmatched };
}

/** Who a typed custom website is (GET /api/chat-computer/logins/identify). */
export interface LoginSiteIdentity {
  url: string;
  /** Hostname, lowercase, without "www.". */
  host: string;
  name: string;
  source: 'catalog' | 'page' | 'domain';
  /** Catalog site id when the address is one of the built-in sites. */
  siteId: string | null;
  /** The catalog site's sign-in page, when it is one. */
  signInUrl: string | null;
}

/** The hostname in a typed website address ("Portal.Acme.com/login" -> "portal.acme.com"), or '' when it doesn't look like one yet. */
export function typedSiteHost(text: string): string {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) ? host.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}


function siteOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Where a running task is and for how long ("On portal.example.test", "1:23"). */
export function computerProgress(
  task: Pick<ComputerTaskView, 'startedAt' | 'currentUrl'>,
  nowMs: number,
): { elapsed: string | null; site: string | null } {
  const started = task.startedAt ? Date.parse(task.startedAt) : NaN;
  const secs = Number.isFinite(started) && nowMs >= started ? Math.floor((nowMs - started) / 1000) : null;
  const elapsed = secs == null ? null : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const site = siteOfUrl(task.currentUrl);
  return { elapsed, site };
}

/** The browser tab says Computer is waiting, so a person in another tab notices. Null when it is not waiting. */
export function computerAttentionTitle(status: ComputerTaskView['status']): string | null {
  if (status === 'needs_you') return 'Computer needs you';
  if (status === 'awaiting_approval') return 'Computer is waiting for your approval';
  return null;
}
