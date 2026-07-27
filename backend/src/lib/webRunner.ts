import { config } from '../config.js';
import { createUserClient } from './supabase.js';
import { HttpError } from './errors.js';
import { openSecret } from './webVault.js';
import { parseHttpUrl } from './webUrlGuard.js';
import { WebBrowserSession } from './webBrowser.js';
import { runWebTask, type RunStep } from './webAgent.js';

/**
 * Executes a queued run: open the site, sign in, hand control to the agent,
 * and write back what happened.
 *
 * Runs are performed in-process and reported by polling rather than held open
 * on the request — a browser session lasts minutes, which is far longer than
 * an HTTP request should. The caller's access token is captured when the run
 * is queued and used for every write, so a run's database writes are subject
 * to exactly the same RLS as the request that started it.
 *
 * Concurrency is capped because each run is a real Chromium process. Over the
 * cap, work is refused at the point of request with a clear message, which is
 * better than accepting it and running the host out of memory.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let activeRuns = 0;

export function activeRunCount(): number {
  return activeRuns;
}

export function hasRunCapacity(): boolean {
  return activeRuns < config.webAccess.maxConcurrentRuns;
}

/**
 * Claims one of the concurrent-browser slots, or reports that none are free.
 *
 * Verifications draw on the same budget as runs, because the constraint being
 * protected is the host's memory and every Chromium costs the same whether it
 * is entering data or checking it. Keeping one counter also means a burst of
 * verifications cannot starve the runs they exist to serve.
 */
export function acquireRunSlot(): boolean {
  if (activeRuns >= config.webAccess.maxConcurrentRuns) return false;
  activeRuns += 1;
  return true;
}

export function releaseRunSlot(): void {
  activeRuns = Math.max(0, activeRuns - 1);
  // A run finishing frees a browser, and the verifier's queue is waiting on
  // exactly that. Without this notification, checks queued while runs were
  // saturating the host would sit until some *other* check happened to finish
  // — which, if none is running, is never.
  onSlotReleased?.();
}

let onSlotReleased: (() => void) | null = null;

export function setSlotReleasedHook(hook: (() => void) | null): void {
  onSlotReleased = hook;
}

/**
 * Called when a run finishes claiming it succeeded.
 *
 * A callback rather than a direct import because the verifier already depends
 * on this module for sign-in, and having this module import the verifier back
 * would be a cycle. The wiring happens once at startup, which also means a
 * deployment can leave the verifier off entirely and runs behave exactly as
 * they did before.
 */
export type RunSucceededHook = (event: {
  accessToken: string;
  runId: string;
  connection: ConnectionRecord;
  kind: 'pull' | 'push';
}) => void;

let onRunSucceeded: RunSucceededHook | null = null;

export function setRunSucceededHook(hook: RunSucceededHook | null): void {
  onRunSucceeded = hook;
}

export interface ConnectionRecord {
  id: string;
  org_id: string;
  label: string;
  site_url: string;
  login_url: string | null;
  username: string;
}

interface StartRunInput {
  accessToken: string;
  runId: string;
  connection: ConnectionRecord;
  kind: 'pull' | 'push';
  instruction: string;
  inputData?: unknown;
}

/** Reads and unseals a connection's password. */
async function loadPassword(accessToken: string, connectionId: string): Promise<string> {
  const supabase = createUserClient(accessToken);
  const { data, error } = await supabase
    .from('web_credentials')
    .select('ciphertext, iv, auth_tag, key_version')
    .eq('connection_id', connectionId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'web_access_credential_read_failed');
  if (!data) {
    throw new HttpError(400, 'This connection has no stored password.', 'web_access_no_credential');
  }

  try {
    return openSecret({
      ciphertext: data.ciphertext as string,
      iv: data.iv as string,
      authTag: data.auth_tag as string,
      keyVersion: data.key_version as number,
    });
  } catch {
    // Practically always a rotated WEB_ACCESS_KEY. Say what fixes it.
    throw new HttpError(
      400,
      'The stored password could not be unsealed. Re-enter it on the connection.',
      'web_access_credential_unreadable',
    );
  }
}

export type SignedInSession =
  | { ok: true; session: WebBrowserSession }
  | { ok: false; reason: string };

/**
 * Opens the connection's site and signs in, returning the live session.
 *
 * Shared with the verifier, which needs exactly this and must not grow its own
 * copy: a second sign-in path is a second place for the password to be
 * mishandled, and it would drift from this one. The verifier passes
 * `readOnly`, which makes the returned session refuse to change anything.
 *
 * The caller owns the session and must close it.
 */
export async function openSignedInSession(
  accessToken: string,
  connection: ConnectionRecord,
  options: { readOnly?: boolean } = {},
): Promise<SignedInSession> {
  const siteUrl = parseHttpUrl(connection.site_url);
  if (!siteUrl) {
    return { ok: false, reason: 'This connection has an invalid site address.' };
  }

  const password = await loadPassword(accessToken, connection.id);
  let session: WebBrowserSession | null = null;

  try {
    session = await WebBrowserSession.open(siteUrl, { readOnly: options.readOnly });
    const result = await session.signIn({
      loginUrl: connection.login_url ?? undefined,
      username: connection.username,
      password,
    });
    if (!result.ok) {
      await session.close();
      return { ok: false, reason: result.reason };
    }
    return { ok: true, session };
  } catch (err) {
    await session?.close();
    throw err;
  }
}

async function markRun(
  accessToken: string,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = createUserClient(accessToken);
  const { error } = await supabase.from('web_runs').update(patch).eq('id', runId);
  if (error) {
    // The run itself is already over by the time most of these fire; losing the
    // status write is worth logging but not worth crashing the process for.
    console.error(`[web-access] failed to update run ${runId}: ${error.message}`);
  }
}

async function updateConnectionStatus(
  accessToken: string,
  connectionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = createUserClient(accessToken);
  await supabase.from('web_connections').update(patch).eq('id', connectionId);
}

/**
 * Signs in and hands the page to the agent. Split out so `verifyConnection`
 * can reuse the sign-in half without running a task.
 */
async function executeRun(input: StartRunInput): Promise<void> {
  const { accessToken, runId, connection, kind, instruction, inputData } = input;
  const startedAt = new Date().toISOString();
  await markRun(accessToken, runId, { status: 'running', started_at: startedAt });

  const siteUrl = parseHttpUrl(connection.site_url);
  if (!siteUrl) {
    await markRun(accessToken, runId, {
      status: 'failed',
      error: 'This connection has an invalid site address.',
      finished_at: new Date().toISOString(),
    });
    return;
  }

  let session: WebBrowserSession | null = null;
  const steps: RunStep[] = [];

  try {
    const password = await loadPassword(accessToken, connection.id);
    session = await WebBrowserSession.open(siteUrl);

    const signIn = await session.signIn({
      loginUrl: connection.login_url ?? undefined,
      username: connection.username,
      password,
    });

    if (!signIn.ok) {
      await updateConnectionStatus(accessToken, connection.id, {
        status: 'failed',
        last_error: signIn.reason,
      });
      await markRun(accessToken, runId, {
        status: 'failed',
        error: `Sign-in failed. ${signIn.reason}`,
        finished_at: new Date().toISOString(),
      });
      return;
    }

    await updateConnectionStatus(accessToken, connection.id, {
      status: 'verified',
      last_verified_at: new Date().toISOString(),
      last_error: null,
    });

    const outcome = await runWebTask({
      session,
      kind,
      instruction,
      inputData,
      siteLabel: connection.label,
      deadline: Date.now() + config.webAccess.runTimeoutMs,
      onStep: (step) => steps.push(step),
    });

    await markRun(accessToken, runId, {
      status: outcome.completed ? 'succeeded' : 'failed',
      result: { summary: outcome.summary, records: outcome.records },
      steps: outcome.steps,
      error: outcome.completed ? null : outcome.summary,
      finished_at: new Date().toISOString(),
    });

    // "Succeeded" at this point means the model said so. Hand it to the
    // verifier, which will go and look. A failure needs no second opinion —
    // it already reported the truth.
    if (outcome.completed) {
      onRunSucceeded?.({ accessToken, runId, connection, kind });
    }
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'The run failed unexpectedly.';
    if (!(err instanceof HttpError)) {
      console.error(`[web-access] run ${runId} failed:`, err);
    }
    await markRun(accessToken, runId, {
      status: 'failed',
      error: message,
      steps,
      finished_at: new Date().toISOString(),
    });
  } finally {
    await session?.close();
  }
}

/**
 * Queues a run and returns immediately. The caller polls the run row for
 * progress.
 */
export function startRun(input: StartRunInput): void {
  // The route checks capacity before inserting the run row, but awaits happen
  // in between, so the last slot can be taken by another request — or by the
  // verifier's queue — before we get here. Releasing a slot we never claimed
  // would drift the counter below the number of live browsers and the cap
  // would slowly stop meaning anything.
  if (!acquireRunSlot()) {
    void markRun(input.accessToken, input.runId, {
      status: 'failed',
      error: 'Too many browser sessions were running. Start this run again shortly.',
      finished_at: new Date().toISOString(),
    });
    return;
  }

  void executeRun(input)
    .catch((err) => console.error(`[web-access] run ${input.runId} crashed:`, err))
    .finally(() => {
      releaseRunSlot();
    });
}

/**
 * Signs in once and reports whether the credential works — the "test this
 * connection" button. Runs inline: it is quick, and the answer is only useful
 * immediately.
 */
export async function verifyConnection(
  accessToken: string,
  connection: ConnectionRecord,
): Promise<{ ok: boolean; reason?: string }> {
  const siteUrl = parseHttpUrl(connection.site_url);
  if (!siteUrl) {
    return { ok: false, reason: 'This connection has an invalid site address.' };
  }

  const password = await loadPassword(accessToken, connection.id);
  let session: WebBrowserSession | null = null;

  try {
    session = await WebBrowserSession.open(siteUrl);
    const result = await session.signIn({
      loginUrl: connection.login_url ?? undefined,
      username: connection.username,
      password,
    });

    await updateConnectionStatus(accessToken, connection.id, {
      status: result.ok ? 'verified' : 'failed',
      last_verified_at: result.ok ? new Date().toISOString() : null,
      last_error: result.ok ? null : result.reason,
    });

    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } finally {
    await session?.close();
  }
}
