/**
 * Logins page: an org signs in to outside websites ahead of time, so Chat's
 * Computer tasks find them already signed in.
 *
 * Flow: start → a browser session on the org's persistent context opens the
 * site → the person signs in themselves in the live view (Take control) →
 * Done releases the session, which saves the sign-in to the profile, and the
 * site is listed. No AI model runs here; only browser time is metered
 * (feature 'computer').
 *
 * For the live-view sign-in nothing secret is kept: the site's name, URL, who
 * signed in and when, and the cookie DOMAIN names that changed during sign-in
 * (values are fingerprinted in memory to spot changes, never stored), so
 * Remove can clear them from the profile.
 *
 * A Global Admin can also save a username and password for a site so
 * Computer signs back in on its own (autoSignIn.ts). They are sealed with
 * AES-256-GCM under COMPUTER_CREDENTIAL_KEY (credentialCrypto.ts) before they
 * reach the database, never logged, never sent to the AI model, and never
 * returned: the page only ever gets the username (admins only) and "password
 * saved". Without the key, saving passwords is off with a plain message.
 *
 * The session counts toward the one-live-browser-per-org rule. The CDP
 * connection is held by the process that started the sign-in; if another
 * replica gets "Done", the session is still released and the site saved, just
 * without its cookie domains (Remove then cannot clear cookies; it says so).
 */
import { logger } from '../lib/logger.js';
import { autoSignIn, type AutoSignInOutcome } from './autoSignIn.js';
import {
  CREDENTIALS_OFF_MESSAGE,
  CredentialsOffError,
  credentialKeyFingerprint,
  credentialsEnabled,
  openCredential,
  sealCredential,
} from './credentialCrypto.js';
import { computerSettings, helperSessionStale, LOGIN_SESSION_SEC, NOT_SET_UP_MESSAGE } from './config.js';
import { meterBrowserTime } from './metering.js';
import { ComputerServiceError, cleanUrl } from './service.js';
import { quickSiteName } from './siteIdentity.js';
import {
  SessionBusyError,
  type ComputerCredentialRow,
  type ComputerLoginRow,
  type ComputerSessionRow,
  type ComputerStore,
  type SessionPurpose,
} from './store.js';
import { changedCookieDomains, type ComputerDriver, type ComputerSessionHandle, type CookieSnapshot } from './types.js';
import { assertComputerAiAllowed, computerAdmin, computerWorkerDeps, type ComputerWorkerDeps } from './worker.js';

export interface LoginView {
  id: string;
  label: string;
  url: string;
  host: string;
  addedBy: string | null;
  addedAt: string;
  lastSignedInAt: string | null;
  lastSignedInBy: string | null;
  /** True when we recorded which cookies to clear on Remove. */
  canClearCookies: boolean;
  /** The saved username and password, if any. The password itself is never sent. */
  credential: CredentialView | null;
}

export interface CredentialView {
  saved: true;
  /** Only for admins (who can manage saved passwords); null for everyone else. */
  username: string | null;
  loginUrl: string | null;
  status: 'ok' | 'needs_attention';
  attentionReason: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** What the page needs to know about saving passwords. */
export interface PasswordsState {
  /** COMPUTER_CREDENTIAL_KEY is set. */
  enabled: boolean;
  /** Plain reason when not enabled. */
  message: string | null;
  /** This viewer may save, see usernames for, replace and delete saved passwords (Global Admin). */
  canManage: boolean;
}

export interface CredentialInput {
  username: string;
  password: string;
  loginUrl?: string | null;
}

export interface ActiveSignIn {
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
  autoSignIn?: { outcome: AutoSignInOutcome; message: string } | null;
}

export interface LoginsState {
  configured: boolean;
  message: string | null;
  logins: LoginView[];
  /** A sign-in in progress for this org (anyone's). */
  signingIn: ActiveSignIn | null;
  /** Why a new sign-in can't start right now, if so. */
  busy: string | null;
  passwords: PasswordsState;
}

/** Sign-ins held open by this process. Key: computer_sessions.id. */
interface HeldSignIn {
  orgId: string;
  handle: ComputerSessionHandle;
  driver: ComputerDriver;
  before: CookieSnapshot;
  timer: NodeJS.Timeout;
}
const held = new Map<string, HeldSignIn>();

function need(): ComputerWorkerDeps {
  const d = computerWorkerDeps();
  if (!d || !d.provider.configured()) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  return d;
}

function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\b(?:wss?|https?):\/\/\S+/gi, '[url]').slice(0, 300);
}

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

function defaultLabel(host: string): string {
  return host.replace(/^www\./, '');
}

async function names(ids: Array<string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const admin = computerAdmin();
  if (!want.length || !admin) return out;
  const { data } = await admin.from('profiles').select('id, full_name, email').in('id', want);
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
    out.set(p.id, (p.full_name || p.email || '').trim() || 'A teammate');
  }
  return out;
}

function audit(store: ComputerStore, orgId: string, sessionId: string | null, userId: string | null, event: string, detail: Record<string, unknown> = {}) {
  return store
    .appendAudit({ org_id: orgId, task_id: null, session_id: sessionId, actor_kind: userId ? 'user' : 'system', actor_user_id: userId, event, detail })
    .catch(() => undefined);
}

/** Close a sign-in session row and its browser, metering the time. */
async function releaseSession(d: ComputerWorkerDeps, row: ComputerSessionRow, userId: string | null): Promise<void> {
  const h = held.get(row.id);
  if (h) {
    clearTimeout(h.timer);
    held.delete(row.id);
    await h.driver.close().catch(() => undefined);
  }
  if (row.provider_session_id) await d.provider.endSession(row.provider_session_id).catch(() => undefined);
  const seconds = Math.max(0, (d.now() - Date.parse(row.started_at)) / 1000);
  meterBrowserTime(d.meteringClient, {
    orgId: row.org_id,
    taskId: row.purpose,
    sessionId: row.id,
    jobId: null,
    userId: userId ?? row.started_by,
    seconds,
  });
  const at = new Date(d.now()).toISOString();
  await d.store.updateSession(row.id, { status: 'ended', ended_at: at, browser_seconds: Math.round(seconds), metered_at: at });
}

/**
 * Why the org's browser is not free, or null. A crashed sign-in older than
 * its limit is cleaned up here instead of blocking forever.
 */
async function busyReason(d: ComputerWorkerDeps, orgId: string): Promise<string | null> {
  const task = await d.store.activeTask(orgId);
  if (task) {
    return 'Computer is working on a task for your company right now. Sign-ins can start when it finishes or is stopped.';
  }
  const live = await d.store.liveSession(orgId);
  if (!live) return null;
  if (live.purpose !== 'task' && helperSessionStale(live.started_at, d.now())) {
    await releaseSession(d, live, null).catch(() => undefined);
    return null;
  }
  if (live.purpose === 'login') return `Someone is signing in to ${live.target_label ?? 'a site'} right now. Try again when they're done.`;
  if (live.purpose === 'logout') return 'Computer is clearing a removed site. Try again in a moment.';
  if (live.purpose === 'verify') return `Computer is checking whether it is still signed in to ${live.target_label ?? 'a site'}. Try again in a moment.`;
  return 'Computer is working on a task for your company right now. Sign-ins can start when it finishes or is stopped.';
}

function passwordsState(canManage: boolean): PasswordsState {
  const enabled = credentialsEnabled();
  return { enabled, message: enabled ? null : CREDENTIALS_OFF_MESSAGE, canManage };
}

export async function loginsState(orgId: string, viewerId: string | null, canManage = false): Promise<LoginsState> {
  const d = computerWorkerDeps();
  if (!d || !d.provider.configured()) {
    return { configured: false, message: NOT_SET_UP_MESSAGE, logins: [], signingIn: null, busy: null, passwords: passwordsState(canManage) };
  }
  const [rows, creds] = await Promise.all([d.store.listLogins(orgId), d.store.listCredentials(orgId)]);
  const byLogin = new Map(creds.map((c) => [c.login_id, c]));
  const busy = await busyReason(d, orgId);
  const live = await d.store.liveSession(orgId);
  const signing = live && live.purpose === 'login' ? live : null;
  const who = await names([
    ...rows.flatMap((r) => [r.created_by, r.last_signed_in_by]),
    ...creds.map((c) => c.updated_by),
    signing?.started_by ?? null,
  ]);
  return {
    configured: true,
    message: null,
    logins: rows.map((r) => loginView(r, who, byLogin.get(r.id) ?? null, canManage)),
    signingIn: signing ? activeView(signing, who, viewerId) : null,
    busy: signing ? null : busy,
    passwords: passwordsState(canManage),
  };
}

/** The page's view of a saved password: never the password; the username for admins only. */
function credentialView(c: ComputerCredentialRow, who: Map<string, string>, canManage: boolean): CredentialView {
  let username: string | null = null;
  let status = c.status;
  let attentionReason = c.attention_reason;
  const readable = credentialsEnabled() && c.key_fingerprint === credentialKeyFingerprint();
  if (!readable && credentialsEnabled()) {
    status = 'needs_attention';
    attentionReason = 'This password was saved with a different encryption key. Save it again.';
  }
  if (canManage && readable) {
    try {
      username = openCredential(c.username_sealed, c.org_id, c.login_id, 'username');
    } catch {
      status = 'needs_attention';
      attentionReason = "This saved login can't be read. Save it again.";
    }
  }
  return {
    saved: true,
    username,
    loginUrl: c.login_url,
    status,
    attentionReason,
    lastUsedAt: c.last_used_at,
    updatedAt: c.updated_at,
    updatedBy: c.updated_by ? (who.get(c.updated_by) ?? null) : null,
  };
}

function loginView(r: ComputerLoginRow, who: Map<string, string>, cred: ComputerCredentialRow | null = null, canManage = false): LoginView {
  return {
    id: r.id,
    label: r.label,
    url: r.url,
    host: r.host,
    addedBy: r.created_by ? (who.get(r.created_by) ?? null) : null,
    addedAt: r.created_at,
    lastSignedInAt: r.last_signed_in_at,
    lastSignedInBy: r.last_signed_in_by ? (who.get(r.last_signed_in_by) ?? null) : null,
    canClearCookies: r.cookie_domains.length > 0,
    credential: cred ? credentialView(cred, who, canManage) : null,
  };
}

const NOT_ADMIN = 'Only a Global Admin can save, change or delete saved passwords.';

/** Check a username and password from the page. Errors never repeat the values. */
function cleanCredential(input: CredentialInput): { username: string; password: string; loginUrl: string | null } {
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  if (!username || username.length > 256) throw new ComputerServiceError('Enter the username or email (up to 256 characters).', 'bad_request');
  if (!password || password.length > 512) throw new ComputerServiceError('Enter the password (up to 512 characters).', 'bad_request');
  let loginUrl: string | null = null;
  if (input.loginUrl && String(input.loginUrl).trim()) {
    loginUrl = cleanUrl(input.loginUrl);
    if (!loginUrl) throw new ComputerServiceError('The sign-in page address should look like https://example.com/login.', 'bad_request');
  }
  return { username, password, loginUrl };
}

/** Seal and store a username and password for a listed site (replaces any saved one). */
async function storeCredential(
  store: ComputerStore,
  orgId: string,
  login: ComputerLoginRow,
  userId: string,
  creds: { username: string; password: string; loginUrl: string | null },
  at: string,
): Promise<ComputerCredentialRow> {
  const row = await store.putCredential({
    login_id: login.id,
    org_id: orgId,
    username_sealed: sealCredential(creds.username, orgId, login.id, 'username'),
    password_sealed: sealCredential(creds.password, orgId, login.id, 'password'),
    key_fingerprint: credentialKeyFingerprint(),
    login_url: creds.loginUrl,
    user_id: userId,
    at,
  });
  await audit(store, orgId, null, userId, 'credential_saved', { host: login.host });
  return row;
}

function assertCanManage(canManage: boolean | undefined): void {
  if (!canManage) throw new ComputerServiceError(NOT_ADMIN, 'not_allowed');
  if (!credentialsEnabled()) throw new CredentialsOffError();
}

/** Save (or replace) the username and password for a listed site. Global Admin only. */
export async function saveCredential(input: {
  orgId: string;
  loginId: string;
  userId: string;
  canManage: boolean;
  credential: CredentialInput;
}): Promise<LoginView> {
  assertCanManage(input.canManage);
  const store = computerWorkerDeps()?.store;
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const creds = cleanCredential(input.credential);
  const login = await store.getLogin(input.orgId, input.loginId);
  if (!login) throw new ComputerServiceError('That site is not on your Logins list.', 'not_found');
  const at = new Date(computerWorkerDeps()!.now()).toISOString();
  const row = await storeCredential(store, input.orgId, login, input.userId, creds, at);
  return loginView(login, await names([login.created_by, login.last_signed_in_by, row.updated_by]), row, true);
}

/** Delete the saved username and password for a site (the site stays listed). Global Admin only. */
export async function deleteCredential(input: { orgId: string; loginId: string; userId: string; canManage: boolean }): Promise<{ deleted: boolean }> {
  if (!input.canManage) throw new ComputerServiceError(NOT_ADMIN, 'not_allowed');
  const store = computerWorkerDeps()?.store;
  if (!store) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const login = await store.getLogin(input.orgId, input.loginId);
  if (!login) throw new ComputerServiceError('That site is not on your Logins list.', 'not_found');
  const deleted = await store.deleteCredential(input.orgId, login.id);
  if (deleted) await audit(store, input.orgId, null, input.userId, 'credential_deleted', { host: login.host });
  return { deleted };
}

function activeView(s: ComputerSessionRow, who: Map<string, string>, viewerId: string | null): ActiveSignIn {
  const url = s.target_url ?? '';
  return {
    sessionId: s.id,
    label: s.target_label ?? (url ? defaultLabel(hostOf(url)) : 'Site'),
    url,
    host: url ? hostOf(url) : '',
    loginId: s.login_id,
    startedAt: s.started_at,
    startedBy: s.started_by ? (who.get(s.started_by) ?? null) : null,
    startedByYou: Boolean(viewerId && s.started_by === viewerId),
    expiresAt: new Date(Date.parse(s.started_at) + LOGIN_SESSION_SEC * 1000).toISOString(),
  };
}

/** Open the site in the org's browser so the person can sign in. */
export async function startSignIn(input: {
  orgId: string;
  userId: string;
  url?: string | null;
  label?: string | null;
  loginId?: string | null;
  canManage?: boolean;
  /** Optional username and password to save for the site (Global Admin only). */
  credential?: CredentialInput | null;
}): Promise<ActiveSignIn> {
  const d = need();
  const creds = input.credential ? (assertCanManage(input.canManage), cleanCredential(input.credential)) : null;
  let url = cleanUrl(input.url);
  let label = String(input.label ?? '').trim().slice(0, 80);
  let loginId: string | null = null;
  if (input.loginId) {
    const existing = await d.store.getLogin(input.orgId, input.loginId);
    if (!existing) throw new ComputerServiceError('That site is not on your Logins list.', 'not_found');
    url = existing.url;
    label = existing.label;
    loginId = existing.id;
  }
  if (!url) throw new ComputerServiceError('Enter the website address, like outlook.office.com.', 'bad_request');
  const host = hostOf(url);
  // No name given (the custom-site form names it itself): catalog name, else the domain, e.g. "Acme".
  if (!label) label = quickSiteName(host);
  try {
    await assertComputerAiAllowed(input.orgId, Boolean(input.canManage));
  } catch (err) {
    throw new ComputerServiceError(err instanceof Error ? err.message : 'AI is paused for this account.', 'ai_paused');
  }
  const busy = await busyReason(d, input.orgId);
  if (busy) throw new ComputerServiceError(busy, 'conflict');

  if (creds) {
    // Save the password first so the sign-in below can use it. A new site is
    // listed (not yet marked signed in) so the password has somewhere to live.
    const at = new Date(d.now()).toISOString();
    const login =
      (loginId && (await d.store.getLogin(input.orgId, loginId))) ||
      (await d.store.saveLogin({ org_id: input.orgId, label, url, host, cookie_domains: [], user_id: input.userId, at, signed_in: false }));
    loginId = login.id;
    await storeCredential(d.store, input.orgId, login, input.userId, creds, at);
  }

  let contextId = await d.store.latestContextId(input.orgId, d.provider.id);
  if (!contextId) {
    contextId = await d.provider.createContext(input.orgId);
    await audit(d.store, input.orgId, null, input.userId, 'context_created');
  }
  let row: ComputerSessionRow;
  try {
    row = await d.store.insertSession({
      org_id: input.orgId,
      provider: d.provider.id,
      provider_context_id: contextId,
      purpose: 'login',
      login_id: loginId,
      target_url: url,
      target_label: label,
      started_by: input.userId,
    });
  } catch (err) {
    if (err instanceof SessionBusyError) throw new ComputerServiceError(err.message, 'conflict');
    throw err;
  }
  try {
    const handle = await d.provider.createSession({ orgId: input.orgId, contextId, timeoutSec: LOGIN_SESSION_SEC + 60 });
    const startedAt = handle.startedAt.toISOString();
    await d.store.updateSession(row.id, { status: 'active', provider_session_id: handle.providerSessionId, started_at: startedAt });
    row = { ...row, status: 'active', provider_session_id: handle.providerSessionId, started_at: startedAt };
    const driver = await d.provider.connect(handle);
    const before = await driver.cookieSnapshot().catch(() => ({}));
    await driver.navigate(url);
    const sessionId = row.id;
    const timer = setTimeout(() => {
      void expireSignIn(input.orgId, sessionId);
    }, LOGIN_SESSION_SEC * 1000);
    timer.unref?.();
    held.set(row.id, { orgId: input.orgId, handle, driver, before, timer });
    await audit(d.store, input.orgId, row.id, input.userId, 'login_started', { host, existing: Boolean(loginId) });
  } catch (err) {
    logger.error('computer sign-in failed to start', { orgId: input.orgId, error: safeError(err) });
    await releaseSession(d, row, input.userId).catch(() => undefined);
    throw new ComputerServiceError(`Could not open the browser: ${safeError(err)}`, 'unavailable');
  }
  const who = await names([input.userId]);
  const view = activeView(row, who, input.userId);

  // A saved password: Computer types it in; the person checks the live view (and does any code) then presses Done.
  const h = held.get(row.id);
  if (h && loginId && credentialsEnabled()) {
    const [login, credential] = await Promise.all([d.store.getLogin(input.orgId, loginId), d.store.getCredential(input.orgId, loginId)]);
    if (login && credential) {
      const result = await autoSignIn({
        store: d.store,
        driver: h.driver,
        saved: { login, credential },
        now: d.now,
        audit: { sessionId: row.id, userId: input.userId },
      }).catch(() => ({ outcome: 'incomplete' as const, message: `Computer couldn't fill in the sign-in form for ${login.label}.` }));
      view.autoSignIn = result;
    }
  }
  return view;
}

async function liveSignIn(d: ComputerWorkerDeps, orgId: string, sessionId: string): Promise<ComputerSessionRow> {
  const row = await d.store.getSession(sessionId);
  if (!row || row.org_id !== orgId || row.purpose !== 'login') throw new ComputerServiceError('Sign-in not found', 'not_found');
  if (row.status !== 'active' || !row.provider_session_id) {
    throw new ComputerServiceError('This sign-in has already ended. Start it again from Logins.', 'conflict');
  }
  return row;
}

/** A fresh, short-lived live-view link (always with control). Never stored or logged. */
export async function signInLiveView(orgId: string, sessionId: string, userId: string) {
  const d = need();
  const row = await liveSignIn(d, orgId, sessionId);
  const link = await d.provider.liveViewUrl(row.provider_session_id!, { expiresInSec: computerSettings().liveViewTtlSec });
  await audit(d.store, orgId, row.id, userId, 'login_live_view_opened');
  return { url: link.url, expiresAt: link.expiresAt, mode: 'control' as const };
}

/** "Done, I'm signed in": release the browser (saving the profile) and list the site. */
export async function finishSignIn(orgId: string, sessionId: string, userId: string): Promise<LoginView> {
  const d = need();
  const row = await liveSignIn(d, orgId, sessionId);
  const h = held.get(row.id);
  let cookieDomains: string[] = [];
  if (h) {
    try {
      cookieDomains = changedCookieDomains(h.before, await h.driver.cookieSnapshot());
    } catch (err) {
      logger.warn('computer sign-in cookie read failed', { orgId, error: safeError(err) });
    }
  }
  // When this process does not hold the driver (restart / other replica), we
  // cannot compute a before/after cookie diff. provider_session_id is still
  // persisted and connect() can re-fetch connectUrl; cookie domains stay empty
  // and Remove will say so (same as before).
  await releaseSession(d, row, userId);
  const url = row.target_url!;
  const saved = await d.store.saveLogin({
    org_id: orgId,
    label: row.target_label ?? defaultLabel(hostOf(url)),
    url,
    host: hostOf(url),
    cookie_domains: cookieDomains,
    user_id: userId,
    at: new Date(d.now()).toISOString(),
  });
  await d.store.updateSession(row.id, { login_id: saved.id }).catch(() => undefined);
  await audit(d.store, orgId, row.id, userId, 'login_saved', { host: saved.host, cookieDomains: cookieDomains.length, recorded: Boolean(h) });
  return loginView(saved, await names([saved.created_by, saved.last_signed_in_by]));
}

/** Close the browser without saving the site. */
export async function cancelSignIn(orgId: string, sessionId: string, userId: string): Promise<void> {
  const d = need();
  const row = await d.store.getSession(sessionId);
  if (!row || row.org_id !== orgId || row.purpose !== 'login') throw new ComputerServiceError('Sign-in not found', 'not_found');
  if (row.status === 'ended' || row.status === 'failed') return;
  await releaseSession(d, row, userId);
  await audit(d.store, orgId, row.id, userId, 'login_canceled', { host: row.target_url ? hostOf(row.target_url) : null });
}

async function expireSignIn(orgId: string, sessionId: string): Promise<void> {
  const d = computerWorkerDeps();
  if (!d) return;
  const row = await d.store.getSession(sessionId).catch(() => null);
  if (!row || row.status !== 'active') return;
  await releaseSession(d, row, null).catch(() => undefined);
  await audit(d.store, orgId, row.id, null, 'login_expired');
}

export interface RemoveResult {
  removed: true;
  cookiesCleared: boolean;
  /** Plain sentence for the page. */
  message: string;
}

/**
 * Remove a site from the list and clear the cookies its sign-in set, so
 * Computer is signed out of it. Domains another saved site also uses (say a
 * shared Microsoft sign-in domain) are kept so that site stays signed in.
 */
export async function removeLogin(orgId: string, loginId: string, userId: string, canManage = false): Promise<RemoveResult> {
  const d = computerWorkerDeps();
  if (!d) throw new ComputerServiceError(NOT_SET_UP_MESSAGE, 'not_set_up');
  const login = await d.store.getLogin(orgId, loginId);
  if (!login) throw new ComputerServiceError('That site is not on your Logins list.', 'not_found');
  // Removing a site deletes its saved password too, so it takes an admin when there is one.
  const hasCredential = Boolean(await d.store.getCredential(orgId, login.id));
  if (hasCredential && !canManage) {
    throw new ComputerServiceError('This site has a saved password. Only a Global Admin can remove it.', 'not_allowed');
  }
  const dropLogin = async () => {
    if (hasCredential) {
      await d.store.deleteCredential(orgId, login.id);
      await audit(d.store, orgId, null, userId, 'credential_deleted', { host: login.host });
    }
    await d.store.deleteLogin(orgId, login.id);
  };
  const others = (await d.store.listLogins(orgId)).filter((l) => l.id !== login.id);
  const shared = new Set(others.flatMap((l) => l.cookie_domains));
  const toClear = login.cookie_domains.filter((dom) => !shared.has(dom));
  const keptShared = login.cookie_domains.length - toClear.length;

  if (!toClear.length || !d.provider.configured()) {
    await dropLogin();
    await audit(d.store, orgId, null, userId, 'login_removed', { host: login.host, cleared: 0 });
    return {
      removed: true,
      cookiesCleared: false,
      message: !login.cookie_domains.length
        ? `Removed ${login.label}. Its sign-in cookies weren't recorded, so Computer may still be signed in there.`
        : keptShared
          ? `Removed ${login.label}. Its sign-in is shared with another site on your list, so it was kept.`
          : `Removed ${login.label}. Computer isn't set up, so its cookies could not be cleared.`,
    };
  }

  const busy = await busyReason(d, orgId);
  if (busy) throw new ComputerServiceError(`${busy} Remove needs the browser for a few seconds to sign out.`, 'conflict');
  const contextId = await d.store.latestContextId(orgId, d.provider.id);
  if (!contextId) {
    await dropLogin();
    return { removed: true, cookiesCleared: false, message: `Removed ${login.label}.` };
  }
  let row: ComputerSessionRow;
  try {
    row = await d.store.insertSession({
      org_id: orgId,
      provider: d.provider.id,
      provider_context_id: contextId,
      purpose: 'logout' satisfies SessionPurpose,
      login_id: login.id,
      target_url: login.url,
      target_label: login.label,
      started_by: userId,
    });
  } catch (err) {
    if (err instanceof SessionBusyError) throw new ComputerServiceError(err.message, 'conflict');
    throw err;
  }
  let cleared: number;
  let driver: ComputerDriver | null = null;
  try {
    const handle = await d.provider.createSession({ orgId, contextId, timeoutSec: 120 });
    const startedAt = handle.startedAt.toISOString();
    await d.store.updateSession(row.id, { status: 'active', provider_session_id: handle.providerSessionId, started_at: startedAt });
    row = { ...row, status: 'active', provider_session_id: handle.providerSessionId, started_at: startedAt };
    driver = await d.provider.connect(handle);
    cleared = await driver.clearSiteData(toClear);
  } catch (err) {
    logger.error('computer sign-out failed', { orgId, error: safeError(err) });
    await driver?.close().catch(() => undefined);
    await releaseSession(d, row, userId).catch(() => undefined);
    throw new ComputerServiceError(`Could not clear the sign-in: ${safeError(err)}. The site is still listed; try Remove again.`, 'unavailable');
  }
  await driver.close().catch(() => undefined);
  await releaseSession(d, row, userId);
  await dropLogin();
  await audit(d.store, orgId, row.id, userId, 'login_removed', { host: login.host, cleared, domains: toClear.length, keptShared });
  return {
    removed: true,
    cookiesCleared: true,
    message: keptShared
      ? `Removed ${login.label} and signed Computer out of it. A sign-in it shares with another site on your list was kept.`
      : `Removed ${login.label} and signed Computer out of it.`,
  };
}


export type VerifyLoginStatus = 'signed_in' | 'needs_sign_in' | 'captcha' | 'two_factor' | 'number_match' | 'unclear';

export interface VerifyLoginResult {
  status: VerifyLoginStatus;
  /** Plain sentence for the person. Never invents credentials or codes. */
  message: string;
  host: string;
  label: string;
  /** Where the browser landed (host only in logs; full URL returned to the caller). */
  url: string | null;
}

/**
 * Check login / warm-up: open the saved site on the org's persistent browser
 * profile, detect signed-in vs a login / MFA / captcha page, report clearly,
 * and release. Does not type passwords or invent codes.
 */
export async function verifyLogin(orgId: string, loginId: string, userId: string): Promise<VerifyLoginResult> {
  const d = need();
  const login = await d.store.getLogin(orgId, loginId);
  if (!login) throw new ComputerServiceError('That site is not on your Logins list.', 'not_found');
  try {
    await assertComputerAiAllowed(orgId, false);
  } catch (err) {
    throw new ComputerServiceError(err instanceof Error ? err.message : 'AI is paused for this account.', 'ai_paused');
  }
  const busy = await busyReason(d, orgId);
  if (busy) throw new ComputerServiceError(busy, 'conflict');

  let contextId = await d.store.latestContextId(orgId, d.provider.id);
  if (!contextId) {
    contextId = await d.provider.createContext(orgId);
    await audit(d.store, orgId, null, userId, 'context_created');
  }

  let row: ComputerSessionRow;
  try {
    row = await d.store.insertSession({
      org_id: orgId,
      provider: d.provider.id,
      provider_context_id: contextId,
      purpose: 'verify',
      login_id: login.id,
      target_url: login.url,
      target_label: login.label,
      started_by: userId,
    });
  } catch (err) {
    if (err instanceof SessionBusyError) throw new ComputerServiceError(err.message, 'conflict');
    throw err;
  }

  let driver: ComputerDriver | null = null;
  let result: VerifyLoginResult;
  try {
    const handle = await d.provider.createSession({ orgId, contextId, timeoutSec: 120 });
    const startedAt = handle.startedAt.toISOString();
    await d.store.updateSession(row.id, { status: 'active', provider_session_id: handle.providerSessionId, started_at: startedAt });
    row = { ...row, status: 'active', provider_session_id: handle.providerSessionId, started_at: startedAt };
    driver = await d.provider.connect(handle);
    // Prefer the saved sign-in page when we have one; otherwise the site home.
    const credential = await d.store.getCredential(orgId, login.id);
    const openUrl = credential?.login_url || login.url;
    await driver.navigate(openUrl);
    const signals = await driver.pageSignals().catch(() => null);
    const url = await driver.currentUrl().catch(() => null);
    result = classifyWarmup(login, signals, url);
    await audit(d.store, orgId, row.id, userId, 'login_verified', {
      host: login.host,
      status: result.status,
    });
  } catch (err) {
    logger.error('computer check login failed', { orgId, error: safeError(err) });
    await driver?.close().catch(() => undefined);
    await releaseSession(d, row, userId).catch(() => undefined);
    throw new ComputerServiceError(`Could not check this login: ${safeError(err)}`, 'unavailable');
  }
  await driver.close().catch(() => undefined);
  await releaseSession(d, row, userId);
  return result;
}

/** Classify the page after opening a saved site. Never invents credentials. */
export function classifyWarmup(
  login: Pick<ComputerLoginRow, 'label' | 'host'>,
  signals: Awaited<ReturnType<ComputerDriver['pageSignals']>> | null,
  url: string | null,
): VerifyLoginResult {
  const name = login.label || login.host;
  const base = { host: login.host, label: name, url };
  if (!signals) {
    return {
      ...base,
      status: 'unclear',
      message: `Opened ${name}, but Computer could not read the page. Open Sign in again if you need to refresh the session.`,
    };
  }
  if (signals.hasCaptcha) {
    return {
      ...base,
      status: 'captcha',
      message: `${name} showed a captcha. Computer never solves captchas — use Sign in again and complete it in the live view.`,
    };
  }
  if (signals.approvalNumber) {
    return {
      ...base,
      status: 'number_match',
      message: `${name} is asking you to approve ${signals.approvalNumber} on your phone. Use Sign in again to finish it in the live view.`,
    };
  }
  if (signals.hasOneTimeCodeField || signals.mentionsVerificationCode) {
    return {
      ...base,
      status: 'two_factor',
      message: `${name} is asking for a verification code. Use Sign in again to enter it in the live view.`,
    };
  }
  if (signals.hasPasswordField) {
    return {
      ...base,
      status: 'needs_sign_in',
      message: `${name} is showing a sign-in page. Computer is not signed in there anymore — use Sign in again.`,
    };
  }
  return {
    ...base,
    status: 'signed_in',
    message: `Computer looks signed in to ${name}. Later tasks should reuse this session without asking you to sign in again unless the site logs it out.`,
  };
}

/** Tests: drop any sign-ins this process holds. */
export function resetSignInsForTests(): void {
  for (const h of held.values()) clearTimeout(h.timer);
  held.clear();
}
