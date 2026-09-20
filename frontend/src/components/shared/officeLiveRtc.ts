/**
 * Office-side WebRTC viewer for Field Capture Live.
 * Signaling: /api/live/signal (cookie session or explicit accessToken).
 */

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type LiveRtcViewerOpts = {
  jobId: string;
  clipId: string;
  signalPath?: string;
  iceServers?: IceServer[];
  /** Absolute API origin when the SPA is not same-origin with the BFF. */
  apiBase?: string;
  accessToken?: string;
  onStream: (stream: MediaStream) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

function signalWsUrl(signalPath: string, apiBase?: string): string {
  const path = signalPath.startsWith('/') ? signalPath : `/${signalPath}`;
  if (apiBase && /^https?:/i.test(apiBase)) {
    return apiBase.replace(/^http/i, 'ws') + path;
  }
  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof location !== 'undefined' ? location.host : 'localhost';
  return `${proto}//${host}${path}`;
}

export type LiveRtcViewerHandle = {
  stop: () => void;
};

/**
 * Connect as a Live viewer. Publisher (FC) creates offers; we answer.
 * Returns a handle whose stop() tears down WS + peer connections.
 */
export function connectOfficeLiveRtc(opts: LiveRtcViewerOpts): LiveRtcViewerHandle {
  let closed = false;
  let ws: WebSocket | null = null;
  const pcs = new Map<string, RTCPeerConnection>();
  const iceServers: IceServer[] =
    opts.iceServers && opts.iceServers.length
      ? opts.iceServers
      : [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ];
  const signalPath = opts.signalPath || '/api/live/signal';

  const send = (msg: unknown) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  };

  const closePc = (id: string) => {
    const pc = pcs.get(id);
    if (!pc) return;
    try {
      pc.close();
    } catch {
      /* ignore */
    }
    pcs.delete(id);
  };

  const ensurePc = (remoteId: string): RTCPeerConnection | null => {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const existing = pcs.get(remoteId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers });
    pcs.set(remoteId, pc);
    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] ?? new MediaStream(ev.track ? [ev.track] : []);
      if (stream.getTracks().length) opts.onStream(stream);
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      send({
        type: 'signal',
        to: remoteId,
        data: { type: 'ice', candidate: ev.candidate },
      });
    };
    pc.onconnectionstatechange = () => {
      opts.onStatus?.(pc.connectionState);
      if (pc.connectionState === 'failed') {
        opts.onError?.('Live peer connection failed — falling back to segments.');
      }
    };
    return pc;
  };

  const onSignal = async (from: string, data: { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
    if (!from || !data) return;
    const pc = ensurePc(from);
    if (!pc) return;
    try {
      if (data.type === 'offer' && data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({
          type: 'signal',
          to: from,
          data: { type: 'answer', sdp: pc.localDescription },
        });
        return;
      }
      if (data.type === 'ice' && data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : 'Signal handling failed.');
    }
  };

  try {
    ws = new WebSocket(signalWsUrl(signalPath, opts.apiBase));
  } catch (err) {
    opts.onError?.(err instanceof Error ? err.message : 'Could not open live signal socket.');
    return { stop: () => undefined };
  }

  ws.onopen = () => {
    opts.onStatus?.('connecting');
    const auth: Record<string, string> = {
      type: 'auth',
      role: 'viewer',
      jobId: opts.jobId,
      clipId: opts.clipId,
    };
    if (opts.accessToken) auth.accessToken = opts.accessToken;
    send(auth);
  };

  ws.onmessage = (ev) => {
    let msg: {
      type?: string;
      message?: string;
      iceServers?: IceServer[];
      peers?: Array<{ peerId: string; role: string }>;
      peerId?: string;
      role?: string;
      from?: string;
      data?: { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!msg?.type) return;
    if (msg.type === 'welcome') {
      opts.onStatus?.('joined');
      if (msg.iceServers?.length) {
        // Rebuild is not required mid-session; next PC uses module iceServers.
        iceServers.splice(0, iceServers.length, ...msg.iceServers);
      }
      for (const p of msg.peers ?? []) {
        if (p.role === 'publisher' && p.peerId) {
          // Publisher will offer; ensure PC exists to receive.
          ensurePc(p.peerId);
        }
      }
      return;
    }
    if (msg.type === 'peer-joined' && msg.role === 'publisher' && msg.peerId) {
      ensurePc(msg.peerId);
      return;
    }
    if (msg.type === 'peer-left' && msg.peerId) {
      closePc(msg.peerId);
      return;
    }
    if (msg.type === 'signal' && msg.from && msg.data) {
      void onSignal(msg.from, msg.data);
      return;
    }
    if (msg.type === 'error') {
      opts.onError?.(msg.message || 'Live signal error.');
    }
  };

  ws.onclose = () => {
    if (!closed) opts.onStatus?.('disconnected');
  };

  return {
    stop: () => {
      closed = true;
      for (const id of [...pcs.keys()]) closePc(id);
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
    },
  };
}
