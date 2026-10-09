/**
 * Browserbase adapter.
 *
 * - One Browserbase Context per org holds that org's browser profile, so a
 *   customer who signs in through the live view stays signed in next time.
 * - Every session sets solveCaptchas:false. Browserbase solves captchas by
 *   default; Computer never does. A captcha pauses the task for a person.
 * - Live-view links come from /debug with a short expiresIn, minted per
 *   viewer. They are returned to that viewer and never stored or logged.
 * - connectUrl is cached in memory after createSession. On connect, if the
 *   cache miss (process restart), we re-fetch it from GET /v1/sessions/{id}.
 *   That only helps while the provider session is still RUNNING (e.g. before
 *   CDP inactivity ends it). Full task resume across deploys still needs the
 *   agent loop to be durable; see docs/computer.md.
 *
 * Docs: https://docs.browserbase.com/reference/api/create-a-session,
 * /reference/api/session-live-urls, /features/contexts,
 * /reference/api/get-a-session.
 */
import { chromium } from 'playwright-core';
import { browserbaseCredentials } from '../config.js';
import { browserbaseProxy, orgEgress } from '../egress.js';
import type { ComputerDriver, ComputerProvider, ComputerSessionHandle, LiveViewLink } from '../types.js';
import { PlaywrightDriver } from './playwrightDriver.js';

const API = 'https://api.browserbase.com';

export class BrowserbaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BrowserbaseError';
  }
}

type FetchLike = typeof fetch;

export class BrowserbaseProvider implements ComputerProvider {
  readonly id = 'browserbase' as const;
  private readonly connectUrls = new Map<string, string>();

  constructor(
    private readonly viewport: { width: number; height: number } = { width: 1280, height: 800 },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  configured(): boolean {
    return browserbaseCredentials() !== null;
  }

  private creds() {
    const creds = browserbaseCredentials();
    if (!creds) throw new BrowserbaseError("Computer isn't set up", 503);
    return creds;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { apiKey } = this.creds();
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      // Status only: response bodies can echo request details.
      throw new BrowserbaseError(`Browserbase ${method} ${path.split('?')[0].replace(/[0-9a-f-]{20,}/gi, ':id')} failed (${res.status})`, res.status);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createContext(_orgId: string): Promise<string> {
    const { projectId } = this.creds();
    const out = await this.call<{ id: string }>('POST', '/v1/contexts', { projectId });
    if (!out.id) throw new BrowserbaseError('Browserbase did not return a context id', 502);
    return out.id;
  }

  async createSession(input: { orgId: string; contextId: string; timeoutSec: number }): Promise<ComputerSessionHandle> {
    const { projectId } = this.creds();
    const out = await this.call<{ id: string; connectUrl: string; createdAt?: string; startedAt?: string }>(
      'POST',
      '/v1/sessions',
      {
        projectId,
        browserSettings: {
          context: { id: input.contextId, persist: true },
          viewport: this.viewport,
          solveCaptchas: false,
          blockAds: true,
          recordSession: true,
        },
        // Egress at the org's own location when configured, so a login
        // represents where the team is rather than a data center. Default
        // egress when there is none.
        ...(() => {
          const proxy = browserbaseProxy(orgEgress(input.orgId));
          return proxy ? { proxies: [proxy] } : {};
        })(),
        timeout: Math.min(21_600, Math.max(60, Math.round(input.timeoutSec))),
        // keepAlive stays false: a deploy still ends the CDP connection and the
        // agent loop is not durable yet. We re-fetch connectUrl on miss so a
        // same-process reconnect (or a future keepAlive path) works.
        keepAlive: false,
        userMetadata: { app: 'atmosphere-computer', org: input.orgId },
      },
    );
    if (!out.id || !out.connectUrl) throw new BrowserbaseError('Browserbase did not return a session', 502);
    this.connectUrls.set(out.id, out.connectUrl);
    const started = out.startedAt ?? out.createdAt;
    return {
      providerSessionId: out.id,
      providerContextId: input.contextId,
      startedAt: started ? new Date(started) : new Date(),
    };
  }

  /**
   * Resolve the CDP connect URL: memory cache first, then GET the session.
   * Never logs or returns the URL to callers outside connect().
   */
  private async resolveConnectUrl(providerSessionId: string): Promise<string> {
    const cached = this.connectUrls.get(providerSessionId);
    if (cached) return cached;
    const out = await this.call<{ connectUrl?: string; status?: string }>(
      'GET',
      `/v1/sessions/${encodeURIComponent(providerSessionId)}`,
    );
    if (!out.connectUrl) {
      const status = out.status ? ` (status ${out.status})` : '';
      throw new BrowserbaseError(
        `Browserbase session connect URL is unavailable${status}. The browser session likely ended when the server restarted.`,
        410,
      );
    }
    this.connectUrls.set(providerSessionId, out.connectUrl);
    return out.connectUrl;
  }

  async connect(session: ComputerSessionHandle): Promise<ComputerDriver> {
    const connectUrl = await this.resolveConnectUrl(session.providerSessionId);
    const browser = await chromium.connectOverCDP(connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return new PlaywrightDriver(browser, context, page, this.viewport);
  }

  async liveViewUrl(providerSessionId: string, opts: { expiresInSec: number }): Promise<LiveViewLink> {
    const expiresIn = Math.min(21_600, Math.max(60, Math.round(opts.expiresInSec)));
    const out = await this.call<{ debuggerFullscreenUrl?: string }>(
      'GET',
      `/v1/sessions/${encodeURIComponent(providerSessionId)}/debug?expiresIn=${expiresIn}`,
    );
    if (!out.debuggerFullscreenUrl) throw new BrowserbaseError('Browserbase did not return a live view', 502);
    const url = new URL(out.debuggerFullscreenUrl);
    url.searchParams.set('navbar', 'false');
    return { url: url.toString(), expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async endSession(providerSessionId: string): Promise<void> {
    const { projectId } = this.creds();
    this.connectUrls.delete(providerSessionId);
    await this.call('POST', `/v1/sessions/${encodeURIComponent(providerSessionId)}`, {
      projectId,
      status: 'REQUEST_RELEASE',
    });
  }

  /** Tests: drop the in-memory connectUrl cache (simulates a process restart). */
  clearConnectUrlCacheForTests(): void {
    this.connectUrls.clear();
  }

  /** Tests: resolve connectUrl the same way connect() does (cache, then GET session). */
  resolveConnectUrlForTests(providerSessionId: string): Promise<string> {
    return this.resolveConnectUrl(providerSessionId);
  }
}
