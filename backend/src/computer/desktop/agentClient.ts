/**
 * Talks to the Atmosphere desktop agent on an org's Windows computer.
 *
 * - TLS trusts only the agent's own certificate (pinned per host), so the
 *   connection is safe even though the agent has no public certificate and
 *   its IP changes each time an EC2 desktop starts.
 * - Every request is signed: HMAC-SHA256 over method, path, timestamp and a
 *   hash of the body, with a secret only this server and the agent hold. The
 *   agent rejects a timestamp more than a minute old, so a captured request
 *   can't be replayed later.
 * - Request and response bodies are never logged: a sign-in request carries
 *   a password, and screenshots can show customer data.
 */
import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';

export class DesktopAgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DesktopAgentError';
  }
}

export interface AgentEndpoint {
  /** https://host:port */
  baseUrl: string;
  certPem: string;
  secret: string;
}

/** The value the agent checks in X-Atmos-Signature. */
export function signAgentRequest(secret: string, method: string, path: string, ts: string, body: string): string {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  return createHmac('sha256', secret).update(`${method.toUpperCase()}\n${path}\n${ts}\n${bodyHash}`, 'utf8').digest('hex');
}

export interface AgentTransport {
  request(endpoint: AgentEndpoint, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs?: number): Promise<unknown>;
}

/** Real transport over pinned HTTPS. */
export class HttpsAgentTransport implements AgentTransport {
  constructor(private readonly now: () => number = () => Date.now()) {}

  request(endpoint: AgentEndpoint, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const ts = String(this.now());
    const url = new URL(path, endpoint.baseUrl);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method,
          ca: endpoint.certPem,
          // The pinned certificate is the only trust anchor. Its name is not
          // checked against the host because the host is an IP that changes.
          checkServerIdentity: () => undefined,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            'x-atmos-timestamp': ts,
            'x-atmos-signature': signAgentRequest(endpoint.secret, method, url.pathname, ts, payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) {
              reject(new DesktopAgentError(`Desktop agent ${url.pathname} failed (${status})`, status));
              return;
            }
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch {
              reject(new DesktopAgentError(`Desktop agent ${url.pathname} sent an unreadable reply`, 502));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new DesktopAgentError(`Desktop agent ${url.pathname} timed out`, 504)));
      req.on('error', (err) =>
        reject(err instanceof DesktopAgentError ? err : new DesktopAgentError(`Desktop agent unreachable (${(err as NodeJS.ErrnoException).code ?? 'error'})`, 503)),
      );
      req.end(payload);
    });
  }
}

/** Typed calls the driver and provider make. */
export class DesktopAgentClient {
  constructor(
    readonly endpoint: AgentEndpoint,
    private readonly transport: AgentTransport = new HttpsAgentTransport(),
  ) {}

  async call<T>(path: string, body: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    return (await this.transport.request(this.endpoint, 'POST', path, body, timeoutMs)) as T;
  }

  async health(timeoutMs = 5_000): Promise<{ ok: boolean; version?: string }> {
    return (await this.transport.request(this.endpoint, 'GET', '/health', undefined, timeoutMs)) as { ok: boolean; version?: string };
  }
}
