import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from '../config.js';
import { bearerToken, verifyAgentToken, type AgentIdentity } from './agentTokens.js';
import { imageLimitsFor, scaleFactorFor, type CaptureQuality, type ComputerModel } from './models.js';
import {
  PROTOCOL_VERSION,
  type ActionOutput,
  type AgentMessage,
  type ComputerAction,
  type ServerMessage,
} from './protocol.js';

/**
 * The registry of connected computers.
 *
 * Agents dial in — a laptop behind NAT needs no inbound port — and the hub
 * keeps each socket open, forwarding one action at a time and matching replies
 * by request id.
 *
 * Everything here is per-process and in memory. That is a deliberate fit to
 * what a live socket already is: a connection cannot outlive the process
 * holding it, so persisting the registry would only ever describe agents this
 * instance can no longer reach. Running multiple backend instances behind a
 * load balancer requires sticky routing or a shared relay; see the README.
 */

export interface ConnectedAgent {
  agentId: string;
  orgId: string;
  name: string;
  platform: string;
  agentVersion: string;
  /** Native screen size, in real pixels. */
  screen: { width: number; height: number };
  /** Actions this host can perform. */
  capabilities: string[];
  connectedAt: string;
  /** Resolution the model currently sees, once configured. */
  capture: { width: number; height: number; scale: number } | null;
  /** True while a run is driving this computer. */
  busyWithRunId: string | null;
}

interface Pending {
  resolve: (output: ActionOutput) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  socket: WebSocket;
  identity: AgentIdentity;
  info: ConnectedAgent | null;
  pending: Map<string, Pending>;
  alive: boolean;
}

const HEARTBEAT_MS = 20_000;

class AgentHub {
  private readonly connections = new Map<string, Connection>();
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  /** Wire the hub into the HTTP server's upgrade handshake. */
  attach(server: HttpServer): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      // Screenshots are the payload; a 1080p PNG can be several megabytes.
      maxPayload: 64 * 1024 * 1024,
    });

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/computer/agent-socket') return; // not ours

      if (!config.computerUse.enabled) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const identity = verifyAgentToken(bearerToken(req.headers.authorization));
      if (!identity) {
        // Reject during the handshake so an unauthenticated peer never gets a
        // WebSocket at all.
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => this.register(ws, identity));
    });

    this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_MS);
    // A stray interval must not hold the process open during shutdown.
    this.heartbeat.unref?.();
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const connection of this.connections.values()) {
      connection.socket.close(1001, 'server shutting down');
    }
    this.connections.clear();
    this.wss?.close();
    this.wss = null;
  }

  /** Computers currently online for an organisation. */
  list(orgId: string): ConnectedAgent[] {
    return [...this.connections.values()]
      .map((c) => c.info)
      .filter((info): info is ConnectedAgent => info !== null && info.orgId === orgId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(orgId: string, agentId: string): ConnectedAgent | null {
    const connection = this.connections.get(agentId);
    if (!connection?.info || connection.info.orgId !== orgId) return null;
    return connection.info;
  }

  /**
   * Claim a computer for a run. Two runs driving one mouse would interleave
   * clicks into nonsense, so the claim is exclusive and explicit.
   */
  claim(orgId: string, agentId: string, runId: string): ConnectedAgent {
    const info = this.get(orgId, agentId);
    if (!info) throw new Error('That computer is not connected.');
    if (info.busyWithRunId) throw new Error('That computer is already running a task.');
    info.busyWithRunId = runId;
    return info;
  }

  release(agentId: string, runId: string): void {
    const info = this.connections.get(agentId)?.info;
    if (info?.busyWithRunId === runId) info.busyWithRunId = null;
  }

  /**
   * Tell an agent what resolution to capture at, and report back the size the
   * model will see — which is what the tool definition must declare.
   */
  configure(
    agentId: string,
    model: ComputerModel,
    quality: CaptureQuality,
  ): { width: number; height: number; scale: number } {
    const connection = this.connections.get(agentId);
    if (!connection?.info) throw new Error('That computer is not connected.');

    const limits = imageLimitsFor(model, quality);
    const { width, height } = connection.info.screen;
    const scale = scaleFactorFor(width, height, limits);
    const capture = {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      scale,
    };

    connection.info.capture = capture;
    this.send(connection, { t: 'configure', capture });
    return capture;
  }

  /** Run one action on a computer and wait for its result. */
  invoke(
    agentId: string,
    action: ComputerAction,
    purpose: 'model' | 'preview' = 'model',
    timeoutMs = config.computerUse.actionTimeoutMs,
  ): Promise<ActionOutput> {
    const connection = this.connections.get(agentId);
    if (!connection || !connection.info) {
      return Promise.reject(new Error('That computer is not connected.'));
    }

    const id = randomUUID();
    return new Promise<ActionOutput>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        reject(
          new Error(
            `The computer did not respond to "${action.action}" within ${Math.round(
              timeoutMs / 1000,
            )}s.`,
          ),
        );
      }, timeoutMs);
      // Do not keep the event loop alive purely to wait on an agent.
      timer.unref?.();

      connection.pending.set(id, { resolve, reject, timer });
      this.send(connection, { t: 'invoke', id, action, purpose });
    });
  }

  /* ---------------------------- internals ---------------------------- */

  private register(socket: WebSocket, identity: AgentIdentity): void {
    // A reconnect from the same agent supersedes the stale socket; leaving both
    // open would race two listeners over the same pending-request ids.
    const existing = this.connections.get(identity.agentId);
    if (existing) {
      existing.socket.close(1000, 'superseded by a newer connection');
      this.failPending(existing, 'The computer reconnected.');
    }

    const connection: Connection = { socket, identity, info: null, pending: new Map(), alive: true };
    this.connections.set(identity.agentId, connection);

    socket.on('message', (raw) => {
      connection.alive = true;
      let message: AgentMessage;
      try {
        message = JSON.parse(raw.toString()) as AgentMessage;
      } catch {
        return;
      }
      this.handle(connection, message);
    });

    socket.on('pong', () => {
      connection.alive = true;
    });

    socket.on('close', () => {
      this.failPending(connection, 'The computer disconnected.');
      if (this.connections.get(identity.agentId) === connection) {
        this.connections.delete(identity.agentId);
      }
    });

    socket.on('error', () => {
      // 'close' follows; nothing useful to do here beyond not crashing.
    });
  }

  private handle(connection: Connection, message: AgentMessage): void {
    switch (message.t) {
      case 'hello': {
        if (message.protocol !== PROTOCOL_VERSION) {
          connection.socket.close(
            4400,
            `Unsupported agent protocol v${message.protocol}; this server speaks v${PROTOCOL_VERSION}. Update the agent.`,
          );
          return;
        }
        connection.info = {
          agentId: connection.identity.agentId,
          orgId: connection.identity.orgId,
          name: message.name || connection.identity.name,
          platform: message.platform,
          agentVersion: message.agentVersion,
          screen: message.screen,
          capabilities: message.capabilities,
          connectedAt: new Date().toISOString(),
          capture: null,
          busyWithRunId: null,
        };
        return;
      }

      case 'result': {
        const pending = connection.pending.get(message.id);
        if (!pending) return; // Timed out already; the result is stale.
        connection.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok && message.output) pending.resolve(message.output);
        else pending.reject(new Error(message.error ?? 'The action failed on the computer.'));
        return;
      }

      default:
        return;
    }
  }

  private send(connection: Connection, message: ServerMessage): void {
    if (connection.socket.readyState !== connection.socket.OPEN) return;
    connection.socket.send(JSON.stringify(message));
  }

  /** Drop connections that stopped answering, so the UI never lists a ghost. */
  private sweep(): void {
    for (const connection of this.connections.values()) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      try {
        connection.socket.ping();
      } catch {
        connection.socket.terminate();
      }
    }
  }

  private failPending(connection: Connection, reason: string): void {
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    connection.pending.clear();
  }
}

export const agentHub = new AgentHub();
