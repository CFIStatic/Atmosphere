/**
 * Windows desktop provider: one Windows computer per org, with desktop apps
 * (Xactimate) installed once and kept.
 *
 * - An always-on host is used as is. An EC2 host is started when a task
 *   needs it and stopped after COMPUTER_DESKTOP_IDLE_STOP_MIN with nothing
 *   to do; its disk (apps, their data, their remembered sign-in) persists.
 * - The org "context" is the computer itself, so createContext only names it.
 * - Live view is served by this server (desktop/liveView.ts), never by the
 *   agent directly.
 */
import { randomBytes } from 'node:crypto';
import { logger } from '../../lib/logger.js';
import { DesktopAgentClient, DesktopAgentError, type AgentTransport } from '../desktop/agentClient.js';
import {
  awsCredentials,
  desktopHostFor,
  desktopHosts,
  desktopIdleStopMs,
  DESKTOP_NOT_SET_UP_MESSAGE,
  type DesktopHostConfig,
} from '../desktop/config.js';
import { DesktopDriver } from '../desktop/driver.js';
import { Ec2Client, type Ec2Instance } from '../desktop/ec2.js';
import { liveViewPath, mintLiveToken } from '../desktop/liveView.js';
import type { ComputerDriver, ComputerProvider, ComputerSessionHandle, LiveViewLink } from '../types.js';

export class DesktopNotSetUpError extends Error {
  constructor(message = DESKTOP_NOT_SET_UP_MESSAGE) {
    super(message);
    this.name = 'DesktopNotSetUpError';
  }
}

export interface WindowsDesktopDeps {
  hostFor(orgId: string): DesktopHostConfig | null;
  hosts(): Map<string, DesktopHostConfig>;
  ec2: Pick<Ec2Client, 'describe' | 'start' | 'stop'>;
  transport?: AgentTransport;
  sleep(ms: number): Promise<void>;
  now(): number;
  idleStopMs(): number;
  /** How long to wait for an EC2 desktop to boot and its agent to answer. */
  bootTimeoutMs: number;
}

function defaultDeps(): WindowsDesktopDeps {
  return {
    hostFor: desktopHostFor,
    hosts: desktopHosts,
    ec2: new Ec2Client(awsCredentials),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    idleStopMs: desktopIdleStopMs,
    bootTimeoutMs: 8 * 60_000,
  };
}

/** "orgid.random" — the org is recoverable after a restart. */
function sessionIdFor(orgId: string): string {
  return `${orgId}.${randomBytes(9).toString('base64url')}`;
}

export function orgOfDesktopSession(providerSessionId: string): string {
  return providerSessionId.split('.')[0] ?? '';
}

export class WindowsDesktopProvider implements ComputerProvider {
  readonly id = 'windows' as const;
  private readonly d: WindowsDesktopDeps;
  /** Last time each org's desktop was in use (ms). */
  private readonly lastUsed = new Map<string, number>();
  /** Orgs with a session open right now. */
  private readonly active = new Map<string, Set<string>>();
  private readonly clients = new Map<string, DesktopAgentClient>();

  constructor(
    private readonly viewport: { width: number; height: number } = { width: 1280, height: 800 },
    deps: Partial<WindowsDesktopDeps> = {},
  ) {
    this.d = { ...defaultDeps(), ...deps };
  }

  /** At least one org has a desktop. Whether this org does is checked per session. */
  configured(): boolean {
    return this.d.hosts().size > 0;
  }

  hasDesktop(orgId: string): boolean {
    return this.d.hostFor(orgId) !== null;
  }

  async createContext(orgId: string): Promise<string> {
    if (!this.hasDesktop(orgId)) throw new DesktopNotSetUpError();
    return `desktop:${orgId}`;
  }

  /** Make sure the org's computer is on and its agent answers. Returns the agent's base URL. */
  private async ensureRunning(host: DesktopHostConfig): Promise<string> {
    if (host.url) return host.url;
    const ec2 = host.ec2!;
    const deadline = this.d.now() + this.d.bootTimeoutMs;
    let info: Ec2Instance = await this.d.ec2.describe(ec2);
    let startAsked = false;
    while (this.d.now() < deadline) {
      if (info.state === 'running' && info.publicIp) break;
      if (info.state === 'terminated' || info.state === 'shutting-down') {
        throw new DesktopNotSetUpError("Your company's Windows computer was deleted. An admin needs to set it up again.");
      }
      if (info.state === 'stopped' && !startAsked) {
        await this.d.ec2.start(ec2);
        startAsked = true;
      }
      await this.d.sleep(5_000);
      info = await this.d.ec2.describe(ec2);
    }
    if (info.state !== 'running' || !info.publicIp) throw new DesktopAgentError('The Windows computer did not start in time', 504);
    return `https://${info.publicIp}:${host.port}`;
  }

  private async waitForAgent(client: DesktopAgentClient, host: DesktopHostConfig): Promise<void> {
    // An always-on host should answer at once; a just-booted one needs Windows to sign in first.
    const deadline = this.d.now() + (host.ec2 ? this.d.bootTimeoutMs : 30_000);
    let last: unknown = null;
    while (this.d.now() < deadline) {
      try {
        const h = await client.health();
        if (h.ok) return;
      } catch (err) {
        last = err;
        // A wrong secret or certificate won't fix itself by waiting.
        if (err instanceof DesktopAgentError && (err.status === 401 || err.status === 403)) throw err;
      }
      await this.d.sleep(3_000);
    }
    throw last instanceof Error ? last : new DesktopAgentError('The Windows computer did not answer', 504);
  }

  private async clientFor(orgId: string): Promise<{ client: DesktopAgentClient; host: DesktopHostConfig }> {
    const host = this.d.hostFor(orgId);
    if (!host) throw new DesktopNotSetUpError();
    const baseUrl = await this.ensureRunning(host);
    const client = new DesktopAgentClient({ baseUrl, certPem: host.certPem, secret: host.secret }, this.d.transport);
    return { client, host };
  }

  async createSession(input: { orgId: string; contextId: string; timeoutSec: number }): Promise<ComputerSessionHandle> {
    const id = sessionIdFor(input.orgId);
    const set = this.active.get(input.orgId) ?? new Set<string>();
    set.add(id);
    this.active.set(input.orgId, set);
    this.lastUsed.set(input.orgId, this.d.now());
    try {
      const { client, host } = await this.clientFor(input.orgId);
      await this.waitForAgent(client, host);
      await client.call('/session/start', { sessionId: id, width: this.viewport.width, height: this.viewport.height });
      this.clients.set(id, client);
    } catch (err) {
      set.delete(id);
      throw err;
    }
    return { providerSessionId: id, providerContextId: input.contextId, startedAt: new Date(this.d.now()) };
  }

  private async sessionClient(providerSessionId: string): Promise<DesktopAgentClient> {
    const cached = this.clients.get(providerSessionId);
    if (cached) return cached;
    // After a restart: find the org's computer again (it is still on).
    const { client } = await this.clientFor(orgOfDesktopSession(providerSessionId));
    this.clients.set(providerSessionId, client);
    return client;
  }

  async connect(session: ComputerSessionHandle): Promise<ComputerDriver> {
    return new DesktopDriver(await this.sessionClient(session.providerSessionId), this.viewport);
  }

  /** The agent client for a live session (live view frames and input). */
  async liveClient(providerSessionId: string): Promise<DesktopAgentClient> {
    this.lastUsed.set(orgOfDesktopSession(providerSessionId), this.d.now());
    return this.sessionClient(providerSessionId);
  }

  /** One JPEG of the desktop for the live view (base64). */
  async liveFrame(providerSessionId: string): Promise<string> {
    const client = await this.liveClient(providerSessionId);
    const out = await client.call<{ image?: string }>('/screenshot', { format: 'jpeg', width: this.viewport.width, height: this.viewport.height }, 15_000);
    if (!out.image) throw new DesktopAgentError('No screenshot', 502);
    return out.image;
  }

  /** Forward one live-view input (click/type/key/scroll) to the desktop. */
  async liveInput(providerSessionId: string, body: Record<string, unknown>): Promise<void> {
    const client = await this.liveClient(providerSessionId);
    await client.call('/input', body, 15_000);
  }

  async liveViewUrl(providerSessionId: string, opts: { expiresInSec: number; control?: boolean }): Promise<LiveViewLink> {
    const orgId = orgOfDesktopSession(providerSessionId);
    const host = this.d.hostFor(orgId);
    if (!host) throw new DesktopNotSetUpError();
    const expires = this.d.now() + Math.max(30, opts.expiresInSec) * 1000;
    const token = mintLiveToken(host.secret, { s: providerSessionId, o: orgId, e: expires, c: opts.control === false ? 0 : 1 });
    return { url: liveViewPath(token), expiresAt: new Date(expires).toISOString() };
  }

  async endSession(providerSessionId: string): Promise<void> {
    const orgId = orgOfDesktopSession(providerSessionId);
    const client = this.clients.get(providerSessionId);
    this.clients.delete(providerSessionId);
    this.active.get(orgId)?.delete(providerSessionId);
    this.lastUsed.set(orgId, this.d.now());
    if (client) await client.call('/session/end', { sessionId: providerSessionId }).catch(() => undefined);
  }

  /**
   * Stop EC2 desktops nobody has used for the idle window. Called from the
   * Computer sweep. After a restart the clock starts again from the first
   * sweep, so a desktop left on by a crash is stopped one idle window later.
   */
  async stopIdleDesktops(isBusy: (orgId: string) => Promise<boolean> = async () => false): Promise<number> {
    let stopped = 0;
    const now = this.d.now();
    for (const [orgId, host] of this.d.hosts()) {
      if (!host.ec2) continue;
      if ((this.active.get(orgId)?.size ?? 0) > 0) continue;
      const last = this.lastUsed.get(orgId);
      if (last === undefined) {
        this.lastUsed.set(orgId, now);
        continue;
      }
      if (now - last < this.d.idleStopMs()) continue;
      try {
        if (await isBusy(orgId)) {
          this.lastUsed.set(orgId, now);
          continue;
        }
        const info = await this.d.ec2.describe(host.ec2);
        if (info.state === 'running' || info.state === 'pending') {
          await this.d.ec2.stop(host.ec2);
          stopped += 1;
          logger.info('computer desktop stopped (idle)', { orgId });
        }
        this.lastUsed.set(orgId, now);
      } catch (err) {
        logger.warn('computer desktop idle stop failed', { orgId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return stopped;
  }
}
