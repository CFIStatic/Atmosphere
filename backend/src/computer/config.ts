import { resolveAnthropicModel } from '../lib/anthropicModel.js';
/**
 * Computer settings. Read from the environment on every call so tests and
 * a redeploy with new variables both take effect without a code change.
 *
 * COMPUTER_AGENT_MODEL is separate from every Chat model setting: changing
 * it never moves Chat, and changing Chat never moves Computer.
 */

export const DEFAULT_COMPUTER_AGENT_MODEL = 'claude-sonnet-5-5';

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function numEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export interface ComputerSettings {
  model: string;
  maxSteps: number;
  /** How long a task waits on a person (approval, sign-in, 2FA) before it stops. */
  idleTimeoutMs: number;
  /** Provider cost cap per task, in nanodollars (customers pay 10× this). */
  budgetNanos: number;
  /** Hosted browser hard timeout, seconds. */
  sessionTimeoutSec: number;
  /** Live-view links expire after this many seconds. */
  liveViewTtlSec: number;
  /** Approvals expire if nobody decides in this window. */
  approvalTtlMs: number;
  /** Screenshots kept in the model's context. */
  keepScreenshots: number;
  viewport: { width: number; height: number };
  pollMs: number;
}

export function computerSettings(): ComputerSettings {
  const model = resolveAnthropicModel(process.env.COMPUTER_AGENT_MODEL, DEFAULT_COMPUTER_AGENT_MODEL);
  const idleTimeoutMs = intEnv('COMPUTER_IDLE_TIMEOUT_MS', 10 * 60_000, 10_000, 2 * 60 * 60_000);
  const budgetUsd = numEnv('COMPUTER_TASK_BUDGET_USD', 2, 0.01, 100);
  return {
    model,
    maxSteps: intEnv('COMPUTER_MAX_STEPS', 60, 1, 500),
    idleTimeoutMs,
    budgetNanos: Math.round(budgetUsd * 1e9),
    sessionTimeoutSec: intEnv('COMPUTER_SESSION_TIMEOUT_SEC', 30 * 60, 60, 21_600),
    liveViewTtlSec: intEnv('COMPUTER_LIVE_VIEW_TTL_SEC', 5 * 60, 60, 3_600),
    approvalTtlMs: idleTimeoutMs,
    keepScreenshots: 3,
    viewport: { width: 1280, height: 800 },
    pollMs: intEnv('COMPUTER_POLL_MS', 1_500, 10, 30_000),
  };
}

/**
 * Tolerate a value pasted as `NAME=value` or wrapped in quotes (an easy slip
 * when copying from a .env file), so the key still authenticates.
 */
export function cleanEnvSecret(name: string, raw: string | undefined): string {
  let v = (raw ?? '').trim();
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function browserbaseCredentials(): { apiKey: string; projectId: string } | null {
  const apiKey = cleanEnvSecret('BROWSERBASE_API_KEY', process.env.BROWSERBASE_API_KEY);
  const projectId = cleanEnvSecret('BROWSERBASE_PROJECT_ID', process.env.BROWSERBASE_PROJECT_ID);
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId };
}

/** Customer-facing. Operators: set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID (docs/computer.md). */
export const NOT_SET_UP_MESSAGE = "Computer isn't set up yet, so Chat can't work in a browser for you.";

/**
 * Logins page: a person signing in to a site holds the org's browser for at
 * most this long (Browserbase gets a minute more), then it is released.
 */
export const LOGIN_SESSION_SEC = 15 * 60;

/** A sign-in / sign-out session older than its limit (plus grace) was left by a crash. */
export function helperSessionStale(startedAtIso: string, nowMs: number): boolean {
  return nowMs - Date.parse(startedAtIso) > (LOGIN_SESSION_SEC + 120) * 1000;
}
