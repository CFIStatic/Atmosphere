import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Agent configuration and enrolment state.
 *
 * A pairing code is single-use and short-lived; the long-lived agent token it
 * buys is what the agent actually reconnects with. The token is written to a
 * file in the user's home directory with owner-only permissions, so a laptop
 * that reboots comes back online without anyone re-pairing it.
 */

export interface StoredCredentials {
  serverUrl: string;
  agentId: string;
  agentToken: string;
  name: string;
}

export interface AgentOptions {
  serverUrl: string;
  pairCode: string | null;
  name: string;
  configPath: string;
  /** Discard stored credentials and re-pair. */
  reset: boolean;
}

const DEFAULT_SERVER = 'http://localhost:4000';

export function parseOptions(argv: string[]): AgentOptions {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, true);
    }
  }

  const str = (key: string): string | undefined => {
    const value = args.get(key);
    return typeof value === 'string' ? value : undefined;
  };

  const serverUrl = (
    str('server') ??
    process.env.ATMOSPHERE_SERVER ??
    DEFAULT_SERVER
  ).replace(/\/+$/, '');

  return {
    serverUrl,
    pairCode: (str('code') ?? process.env.ATMOSPHERE_PAIR_CODE ?? null)?.trim() || null,
    name: str('name') ?? process.env.ATMOSPHERE_AGENT_NAME ?? hostname(),
    configPath: str('config') ?? process.env.ATMOSPHERE_CONFIG ?? defaultConfigPath(),
    reset: args.get('reset') === true,
  };
}

export function defaultConfigPath(): string {
  return join(homedir(), '.atmosphere', 'agent.json');
}

export async function loadCredentials(path: string): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (!parsed.agentToken || !parsed.agentId || !parsed.serverUrl) return null;
    return {
      serverUrl: parsed.serverUrl,
      agentId: parsed.agentId,
      agentToken: parsed.agentToken,
      name: parsed.name ?? hostname(),
    };
  } catch {
    return null;
  }
}

export async function saveCredentials(path: string, creds: StoredCredentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // The token grants control of this machine — never world-readable.
  await writeFile(path, `${JSON.stringify(creds, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** Exchange a one-time pairing code for a durable agent token. */
export async function pair(
  serverUrl: string,
  code: string,
  name: string,
): Promise<StoredCredentials> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/computer/agents/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, platform: process.platform }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Atmosphere at ${serverUrl} (${(err as Error).message}). ` +
        'Check --server and that the backend is running.',
    );
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new Error((body.error as string) ?? `Pairing failed (${res.status}).`);
  }

  return {
    serverUrl,
    agentId: body.agentId as string,
    agentToken: body.agentToken as string,
    name: (body.name as string) ?? name,
  };
}

/** http(s) → ws(s), preserving any path prefix the backend is mounted under. */
export function websocketUrl(serverUrl: string): string {
  const url = new URL(`${serverUrl}/api/computer/agent-socket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
