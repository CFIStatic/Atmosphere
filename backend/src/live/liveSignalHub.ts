/**
 * WebSocket signaling hub for Office Live WebRTC.
 *
 * Field Capture publishes the camera MediaStream; org office viewers subscribe.
 * Durable day-film parts continue to upload in parallel for historical filing.
 *
 * Auth: first message must be `{ type: 'auth', ... }` within AUTH_TIMEOUT_MS.
 * Rooms are keyed by orgId+jobId+clipId after membership is verified.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from '../config.js';
import { createAnonClient, createAdminClient } from '../lib/supabase.js';
import { adminForPartyToken } from '../lib/scopedAdmin.js';
import { buildIceServers, liveSignalPath, type IceServerConfig } from './iceServers.js';

const AUTH_TIMEOUT_MS = 8_000;
const MAX_VIEWERS_PER_ROOM = 8;

export type LiveRole = 'publisher' | 'viewer';

type AuthOk = {
  role: LiveRole;
  orgId: string;
  jobId: string;
  clipId: string;
  partyId: string | null;
  userId: string | null;
};

type Peer = {
  id: string;
  ws: WebSocket;
  role: LiveRole;
  orgId: string;
  jobId: string;
  clipId: string;
  roomKey: string;
};

type Room = {
  key: string;
  orgId: string;
  jobId: string;
  clipId: string;
  peers: Map<string, Peer>;
};

function roomKey(orgId: string, jobId: string, clipId: string): string {
  return `${orgId}:${jobId}:${clipId}`;
}

function readAccessTokenFromRequest(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  // Minimal cookie parse (name=value; name2=value2)
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name === config.cookies.accessTokenName && value) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

function isClipId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[a-z0-9]{6,32}$/.test(raw);
}

function isJobId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 80;
}

async function verifyOrgMembership(
  accessToken: string,
  jobId: string,
): Promise<{ orgId: string; userId: string }> {
  const supabase = createAnonClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) {
    throw new Error('Invalid session.');
  }
  const userId = userData.user.id;
  const admin = createAdminClient();
  if (!admin) throw new Error('Storage is not configured.');
  const { data: membership } = await admin
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const orgId = membership?.org_id as string | undefined;
  if (!orgId) throw new Error('Join or create an organization first.');

  const { data: job } = await admin
    .from('jobs')
    .select('id, org_id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!job) throw new Error('Job not found for this organization.');

  return { orgId, userId };
}

async function authenticateMessage(
  raw: unknown,
  cookieToken: string | undefined,
): Promise<AuthOk> {
  if (!raw || typeof raw !== 'object') throw new Error('Expected auth message.');
  const msg = raw as Record<string, unknown>;
  if (msg.type !== 'auth') throw new Error('First message must be auth.');
  const role = msg.role === 'publisher' || msg.role === 'viewer' ? msg.role : null;
  if (!role) throw new Error('role must be publisher or viewer.');
  if (!isJobId(msg.jobId)) throw new Error('Invalid jobId.');
  if (!isClipId(msg.clipId)) throw new Error('Invalid clipId.');

  const shareToken =
    typeof msg.shareToken === 'string' && msg.shareToken.trim().length >= 8
      ? msg.shareToken.trim()
      : undefined;
  const accessToken =
    (typeof msg.accessToken === 'string' && msg.accessToken.trim()) ||
    cookieToken ||
    undefined;

  if (shareToken) {
    if (role !== 'publisher') {
      throw new Error('Job-share tokens may only publish, not watch Live.');
    }
    const { party } = await adminForPartyToken(shareToken);
    if (party.job_id !== msg.jobId) {
      throw new Error('Share token does not match this job.');
    }
    return {
      role,
      orgId: party.org_id,
      jobId: party.job_id,
      clipId: msg.clipId,
      partyId: party.id,
      userId: null,
    };
  }

  if (!accessToken) throw new Error('Sign in required.');

  const { orgId, userId } = await verifyOrgMembership(accessToken, msg.jobId);

  // Viewers: org staff only (already enforced by membership).
  // Publishers: same — signed-in field crew on an org job.
  return {
    role,
    orgId,
    jobId: msg.jobId,
    clipId: msg.clipId,
    partyId: null,
    userId,
  };
}

export class LiveSignalHub {
  private readonly rooms = new Map<string, Room>();
  private wss: WebSocketServer | null = null;
  private iceServers: IceServerConfig[] = buildIceServers();

  attach(server: HttpServer): void {
    if (this.wss) return;
    this.iceServers = buildIceServers();
    this.wss = new WebSocketServer({
      server,
      path: liveSignalPath(),
      maxPayload: 64 * 1024,
    });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  /** True when a Field Capture publisher is currently in the room. */
  hasPublisher(orgId: string, jobId: string, clipId: string): boolean {
    const room = this.rooms.get(roomKey(orgId, jobId, clipId));
    if (!room) return false;
    for (const peer of room.peers.values()) {
      if (peer.role === 'publisher' && peer.ws.readyState === peer.ws.OPEN) return true;
    }
    return false;
  }

  /** Clip ids on this job that currently have a live publisher. */
  publisherClipIds(orgId: string, jobId: string): string[] {
    const out: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.orgId !== orgId || room.jobId !== jobId) continue;
      for (const peer of room.peers.values()) {
        if (peer.role === 'publisher' && peer.ws.readyState === peer.ws.OPEN) {
          out.push(room.clipId);
          break;
        }
      }
    }
    return out;
  }

  getIceServers(): IceServerConfig[] {
    return this.iceServers;
  }

  close(): void {
    if (!this.wss) return;
    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) {
        try {
          peer.ws.close(1001, 'shutting down');
        } catch {
          /* ignore */
        }
      }
    }
    this.rooms.clear();
    this.wss.close();
    this.wss = null;
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const cookieToken = readAccessTokenFromRequest(req);
    let peer: Peer | null = null;
    let authed = false;

    const authTimer = setTimeout(() => {
      if (!authed) {
        send(ws, { type: 'error', message: 'Auth timeout.' });
        ws.close(4001, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data) => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          send(ws, { type: 'error', message: 'Invalid JSON.' });
          return;
        }

        if (!authed) {
          try {
            const auth = await authenticateMessage(parsed, cookieToken);
            clearTimeout(authTimer);
            authed = true;
            peer = this.joinRoom(ws, auth);
            send(ws, {
              type: 'welcome',
              peerId: peer.id,
              role: peer.role,
              jobId: peer.jobId,
              clipId: peer.clipId,
              iceServers: this.iceServers,
              peers: this.listPeers(peer.roomKey, peer.id),
            });
          } catch (err) {
            send(ws, {
              type: 'error',
              message: err instanceof Error ? err.message : 'Auth failed.',
            });
            ws.close(4003, 'auth failed');
          }
          return;
        }

        if (!peer) return;
        this.handlePeerMessage(peer, parsed);
      })();
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (peer) this.leaveRoom(peer);
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
      if (peer) this.leaveRoom(peer);
    });
  }

  private listPeers(key: string, exceptId: string): Array<{ peerId: string; role: LiveRole }> {
    const room = this.rooms.get(key);
    if (!room) return [];
    const out: Array<{ peerId: string; role: LiveRole }> = [];
    for (const p of room.peers.values()) {
      if (p.id === exceptId) continue;
      if (p.ws.readyState !== p.ws.OPEN) continue;
      out.push({ peerId: p.id, role: p.role });
    }
    return out;
  }

  private joinRoom(ws: WebSocket, auth: AuthOk): Peer {
    const key = roomKey(auth.orgId, auth.jobId, auth.clipId);
    let room = this.rooms.get(key);
    if (!room) {
      room = {
        key,
        orgId: auth.orgId,
        jobId: auth.jobId,
        clipId: auth.clipId,
        peers: new Map(),
      };
      this.rooms.set(key, room);
    }

    if (auth.role === 'viewer') {
      let viewers = 0;
      for (const p of room.peers.values()) {
        if (p.role === 'viewer') viewers += 1;
      }
      if (viewers >= MAX_VIEWERS_PER_ROOM) {
        throw new Error('Too many live viewers on this clip.');
      }
    }

    // One publisher per clip — replace a stale publisher socket.
    if (auth.role === 'publisher') {
      for (const existing of [...room.peers.values()]) {
        if (existing.role === 'publisher') {
          try {
            existing.ws.close(4000, 'replaced');
          } catch {
            /* ignore */
          }
          room.peers.delete(existing.id);
        }
      }
    }

    const peer: Peer = {
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      ws,
      role: auth.role,
      orgId: auth.orgId,
      jobId: auth.jobId,
      clipId: auth.clipId,
      roomKey: key,
    };
    room.peers.set(peer.id, peer);

    for (const other of room.peers.values()) {
      if (other.id === peer.id) continue;
      send(other.ws, { type: 'peer-joined', peerId: peer.id, role: peer.role });
    }
    return peer;
  }

  private leaveRoom(peer: Peer): void {
    const room = this.rooms.get(peer.roomKey);
    if (!room) return;
    if (!room.peers.delete(peer.id)) return;
    for (const other of room.peers.values()) {
      send(other.ws, { type: 'peer-left', peerId: peer.id });
    }
    if (room.peers.size === 0) this.rooms.delete(peer.roomKey);
  }

  private handlePeerMessage(peer: Peer, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    if (msg.type === 'signal') {
      const to = typeof msg.to === 'string' ? msg.to : '';
      if (!to || !msg.data || typeof msg.data !== 'object') return;
      const room = this.rooms.get(peer.roomKey);
      const target = room?.peers.get(to);
      if (!target || target.ws.readyState !== target.ws.OPEN) return;
      // Bound opaque SDP / ICE size roughly via JSON already (maxPayload).
      send(target.ws, { type: 'signal', from: peer.id, data: msg.data });
      return;
    }
    if (msg.type === 'ping') {
      send(peer.ws, { type: 'pong', t: Date.now() });
    }
  }
}

/** Process-wide hub (single HTTP server). */
export const liveSignalHub = new LiveSignalHub();

/** Stable fingerprint for tests — not a secret. */
export function iceServersFingerprint(servers: IceServerConfig[]): string {
  return createHash('sha256').update(JSON.stringify(servers)).digest('hex').slice(0, 12);
}

