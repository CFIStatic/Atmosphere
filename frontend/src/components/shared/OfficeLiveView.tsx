import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OfficeLiveSession, type OfficeLiveSessionDetail } from '../../lib/api';
import { connectOfficeLiveRtc, type LiveRtcViewerHandle } from './officeLiveRtc';

type Props = {
  jobId: string;
};

type Transport = 'webrtc' | 'parts' | 'waiting';

/**
 * Org-office Live player for Field Capture.
 * Prefers WebRTC (≤1–2s); falls back to concatenating durable stream parts.
 * Not shown to homeowners.
 */
export function OfficeLiveView({ jobId }: Props) {
  const [sessions, setSessions] = useState<OfficeLiveSession[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OfficeLiveSessionDetail | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState<Transport>('waiting');
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [latencyNote, setLatencyNote] = useState<string | null>(null);
  const [pollSeconds, setPollSeconds] = useState(2);
  const [signalPath, setSignalPath] = useState('/api/live/signal');
  const [iceServers, setIceServers] = useState<
    Array<{ urls: string | string[]; username?: string; credential?: string }>
  >([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastPartCountRef = useRef(0);
  const playbackUrlRef = useRef<string | null>(null);
  const rtcRef = useRef<LiveRtcViewerHandle | null>(null);
  const webrtcFailedRef = useRef(false);
  const hasRemoteStreamRef = useRef(false);

  const replacePlaybackUrl = useCallback((next: string | null) => {
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
    }
    playbackUrlRef.current = next;
    setPlaybackUrl(next);
  }, []);

  const stopRtc = useCallback(() => {
    if (rtcRef.current) {
      rtcRef.current.stop();
      rtcRef.current = null;
    }
    hasRemoteStreamRef.current = false;
    setHasRemoteStream(false);
    const el = videoRef.current;
    if (el && el.srcObject) {
      el.srcObject = null;
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await api.jobLiveSessions(jobId);
      const next = res.sessions ?? [];
      setSessions(next);
      setError(null);
      if (res.latencyNote) setLatencyNote(res.latencyNote);
      if (typeof res.pollIntervalSeconds === 'number' && res.pollIntervalSeconds > 0) {
        setPollSeconds(res.pollIntervalSeconds);
      }
      if (res.signalPath) setSignalPath(res.signalPath);
      if (res.iceServers?.length) setIceServers(res.iceServers);
      setActiveClipId((prev) => {
        if (prev && next.some((s) => s.clipId === prev)) return prev;
        return next[0]?.clipId ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load live sessions.');
    }
  }, [jobId]);

  const loadPartsDetail = useCallback(
    async (clipId: string) => {
      // Skip regenerating blob while WebRTC is healthy.
      if (hasRemoteStreamRef.current && !webrtcFailedRef.current) {
        try {
          const res = await api.jobLiveSession(jobId, clipId);
          setDetail(res);
          if (res.signalPath) setSignalPath(res.signalPath);
          if (res.iceServers?.length) setIceServers(res.iceServers);
        } catch {
          /* ignore background refresh errors while live */
        }
        return;
      }

      setBusy(true);
      try {
        const res = await api.jobLiveSession(jobId, clipId);
        setDetail(res);
        setError(null);
        if (res.signalPath) setSignalPath(res.signalPath);
        if (res.iceServers?.length) setIceServers(res.iceServers);
        if (res.latencyNote) setLatencyNote(res.latencyNote);

        if (res.session.realtimePublisher && !webrtcFailedRef.current) {
          return;
        }

        if (!res.ready || !res.parts.length) {
          return;
        }
        if (res.parts.length === lastPartCountRef.current && playbackUrlRef.current) {
          return;
        }
        const blobs: Blob[] = [];
        for (const part of res.parts) {
          const r = await fetch(part.url);
          if (!r.ok) throw new Error(`Part ${part.index + 1} could not be fetched.`);
          blobs.push(await r.blob());
        }
        const mime = res.session.mimeType || 'video/webm';
        const combined = new Blob(blobs, { type: mime });
        const url = URL.createObjectURL(combined);
        const el = videoRef.current;
        const wasPlaying = el ? !el.paused : true;
        const t = el?.currentTime || 0;
        lastPartCountRef.current = res.parts.length;
        stopRtc();
        if (el) el.srcObject = null;
        setTransport('parts');
        replacePlaybackUrl(url);
        if (el) {
          const resume = () => {
            try {
              if (t > 0 && Number.isFinite(t)) el.currentTime = Math.min(t, el.duration || t);
              if (wasPlaying) void el.play().catch(() => {});
            } catch {
              /* growing WebM seek can fail */
            }
            el.removeEventListener('loadedmetadata', resume);
          };
          el.addEventListener('loadedmetadata', resume);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load live video.');
      } finally {
        setBusy(false);
      }
    },
    [jobId, replacePlaybackUrl, stopRtc],
  );

  useEffect(() => {
    void refreshSessions();
    const id = window.setInterval(() => void refreshSessions(), pollSeconds * 1000);
    return () => window.clearInterval(id);
  }, [refreshSessions, pollSeconds]);

  useEffect(() => {
    webrtcFailedRef.current = false;
    stopRtc();
    replacePlaybackUrl(null);
    lastPartCountRef.current = 0;
    setTransport('waiting');
    setDetail(null);

    if (!activeClipId) return;

    const session = sessions.find((s) => s.clipId === activeClipId);
    const path = session?.signalPath || signalPath;

    let fallbackTimer: number | undefined;
    let partsInterval: number | undefined;

    rtcRef.current = connectOfficeLiveRtc({
      jobId,
      clipId: activeClipId,
      signalPath: path,
      iceServers: iceServers.length ? iceServers : undefined,
      onStream: (stream) => {
        const el = videoRef.current;
        replacePlaybackUrl(null);
        if (el) {
          el.srcObject = stream;
          void el.play().catch(() => {});
        }
        hasRemoteStreamRef.current = true;
        setHasRemoteStream(true);
        setTransport('webrtc');
        setError(null);
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
      },
      onError: (message) => {
        if (hasRemoteStreamRef.current) return;
        webrtcFailedRef.current = true;
        setError(message);
        stopRtc();
        void loadPartsDetail(activeClipId);
      },
    });

    fallbackTimer = window.setTimeout(() => {
      if (hasRemoteStreamRef.current) return;
      webrtcFailedRef.current = true;
      stopRtc();
      void loadPartsDetail(activeClipId);
    }, 6000);

    void loadPartsDetail(activeClipId);
    partsInterval = window.setInterval(() => {
      void loadPartsDetail(activeClipId);
    }, pollSeconds * 1000);

    return () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (partsInterval) window.clearInterval(partsInterval);
      stopRtc();
    };
    // Re-bind when the active clip changes; session list / ICE refresh separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipId, jobId]);

  useEffect(
    () => () => {
      stopRtc();
      replacePlaybackUrl(null);
    },
    [replacePlaybackUrl, stopRtc],
  );

  if (!sessions.length) {
    return null;
  }

  const session = sessions.find((s) => s.clipId === activeClipId) ?? sessions[0] ?? null;
  const showVideo = Boolean(playbackUrl || hasRemoteStream);

  return (
    <section
      className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"
      data-testid="office-live-view"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            <span className="mr-2 inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              Live
            </span>
            Field Capture on site
            {transport === 'webrtc' && (
              <span
                className="ml-2 text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                data-testid="office-live-transport"
              >
                ≤2s
              </span>
            )}
            {transport === 'parts' && (
              <span
                className="ml-2 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
                data-testid="office-live-transport"
              >
                segments
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {latencyNote ??
              session?.latencyNote ??
              'Live (WebRTC): typically ≤1–2 seconds behind the camera. Parts fallback ~15–35s.'}
          </p>
        </div>
        {sessions.length > 1 && (
          <select
            className="rounded-md border border-line bg-paper-0 px-2 py-1 text-sm"
            value={activeClipId ?? ''}
            onChange={(e) => setActiveClipId(e.target.value)}
            aria-label="Choose live clip"
          >
            {sessions.map((s) => (
              <option key={s.clipId} value={s.clipId}>
                {s.workDate} · {s.phase} · {s.clipId.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          className={`aspect-video w-full ${showVideo ? '' : 'invisible absolute inset-0 h-full w-full'}`}
          controls={showVideo}
          playsInline
          autoPlay
          muted
          src={playbackUrl ?? undefined}
        />
        {!showVideo && (
          <div className="grid aspect-video place-items-center px-4 text-center text-sm text-white/80">
            {busy
              ? 'Connecting to Live…'
              : 'Waiting for Field Capture (WebRTC connects in about a second when the crew is online).'}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-600">
        {detail?.privacyNote ??
          'Live may show unredacted footage until analysis applies child blur / private-moment ranges after the film is filed.'}
        {detail && transport === 'parts'
          ? ` · ${detail.partCount} segment${detail.partCount === 1 ? '' : 's'} on hand.`
          : ''}
        {transport === 'webrtc' ? ' · Realtime peer stream (pre-redaction).' : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
          onClick={() => {
            webrtcFailedRef.current = false;
            if (activeClipId) void loadPartsDetail(activeClipId);
          }}
          disabled={!activeClipId || busy}
        >
          Watch now
        </button>
        <button
          type="button"
          className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm text-ink-700 hover:bg-paper-200"
          onClick={() => void refreshSessions()}
        >
          Refresh
        </button>
      </div>
    </section>
  );
}
