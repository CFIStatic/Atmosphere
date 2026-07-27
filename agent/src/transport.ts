import WebSocket from 'ws';
import type { AgentMessage, ServerMessage } from './protocol.js';

/**
 * The agent's link to the backend.
 *
 * Connections are outbound only: the agent dials the server, so a laptop behind
 * NAT or a corporate firewall needs no inbound port and no public address. If
 * the link drops the agent keeps retrying with backoff — an operator should not
 * have to notice a network blip, walk to the machine, and restart anything.
 */

export interface TransportHandlers {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  onClose(reason: string): void;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Server pings every 20s; assume the link is dead if nothing arrives in 60. */
const IDLE_TIMEOUT_MS = 60_000;

export class AgentTransport {
  private socket: WebSocket | null = null;
  private backoff = INITIAL_BACKOFF_MS;
  private stopped = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly handlers: TransportHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearIdleTimer();
    this.socket?.close(1000, 'agent shutting down');
    this.socket = null;
  }

  send(message: AgentMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private connect(): void {
    const socket = new WebSocket(this.url, {
      headers: { authorization: `Bearer ${this.token}` },
      // Screenshots are the bulk of the traffic and are already PNG-compressed;
      // permessage-deflate would burn CPU on both ends for nothing.
      perMessageDeflate: false,
      maxPayload: 64 * 1024 * 1024,
    });
    this.socket = socket;

    socket.on('open', () => {
      this.backoff = INITIAL_BACKOFF_MS;
      this.resetIdleTimer();
      this.handlers.onOpen();
    });

    socket.on('message', (raw) => {
      this.resetIdleTimer();
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return; // A malformed frame is not worth tearing the link down for.
      }
      this.handlers.onMessage(parsed);
    });

    socket.on('error', (err) => {
      // 'close' always follows; log here so the cause is visible, reconnect there.
      // eslint-disable-next-line no-console
      console.error(`[agent] connection error: ${(err as Error).message}`);
    });

    socket.on('close', (code, reason) => {
      this.clearIdleTimer();
      this.socket = null;
      const text = reason.toString() || `code ${code}`;
      this.handlers.onClose(text);

      // 4401 = the server rejected our token. Retrying cannot fix that, and a
      // revoked agent hammering the endpoint forever helps nobody.
      if (this.stopped || code === 4401) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    // eslint-disable-next-line no-console
    console.log(`[agent] reconnecting in ${Math.round(delay / 1000)}s…`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[agent] no traffic from server; resetting the connection.');
      this.socket?.terminate();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
