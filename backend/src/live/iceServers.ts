/**
 * ICE servers for Office Live WebRTC.
 *
 * STUN alone covers many office↔field paths; restrictive NATs need TURN.
 * Configure LIVE_TURN_URLS (+ optional username/credential) in production.
 */

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const DEFAULT_STUN: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function parseTurnUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build the ICE server list from env (safe to send to browsers). */
export function buildIceServers(env: NodeJS.ProcessEnv = process.env): IceServerConfig[] {
  const out: IceServerConfig[] = [...DEFAULT_STUN];
  const turnUrls = parseTurnUrls(env.LIVE_TURN_URLS);
  if (turnUrls.length) {
    const username = env.LIVE_TURN_USERNAME?.trim() || undefined;
    const credential = env.LIVE_TURN_CREDENTIAL?.trim() || undefined;
    out.push({
      urls: turnUrls.length === 1 ? turnUrls[0]! : turnUrls,
      ...(username ? { username } : {}),
      ...(credential ? { credential } : {}),
    });
  }
  return out;
}

export function liveSignalPath(): string {
  return '/api/live/signal';
}
