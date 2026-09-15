import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OfficeLiveSession, type OfficeLiveSessionDetail } from '../../lib/api';

type Props = {
  jobId: string;
};

/**
 * Org-office Live / near-live player for Field Capture stream-while-recording.
 * Polls session list + part URLs; concatenates contiguous WebM/MP4 parts into
 * a Blob for <video>. Not shown to homeowners.
 */
export function OfficeLiveView({ jobId }: Props) {
  const [sessions, setSessions] = useState<OfficeLiveSession[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OfficeLiveSessionDetail | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastPartCountRef = useRef(0);
  const playbackUrlRef = useRef<string | null>(null);

  const replacePlaybackUrl = useCallback((next: string | null) => {
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
    }
    playbackUrlRef.current = next;
    setPlaybackUrl(next);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await api.jobLiveSessions(jobId);
      const next = res.sessions ?? [];
      setSessions(next);
      setError(null);
      setActiveClipId((prev) => {
        if (prev && next.some((s) => s.clipId === prev)) return prev;
        return next[0]?.clipId ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load live sessions.');
    }
  }, [jobId]);

  const loadDetail = useCallback(
    async (clipId: string) => {
      setBusy(true);
      try {
        const res = await api.jobLiveSession(jobId, clipId);
        setDetail(res);
        setError(null);
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
    [jobId, replacePlaybackUrl],
  );

  useEffect(() => {
    void refreshSessions();
    const id = window.setInterval(() => void refreshSessions(), 5000);
    return () => window.clearInterval(id);
  }, [refreshSessions]);

  useEffect(() => {
    if (!activeClipId) {
      setDetail(null);
      lastPartCountRef.current = 0;
      replacePlaybackUrl(null);
      return;
    }
    lastPartCountRef.current = 0;
    void loadDetail(activeClipId);
    const id = window.setInterval(() => void loadDetail(activeClipId), 5000);
    return () => window.clearInterval(id);
  }, [activeClipId, loadDetail, replacePlaybackUrl]);

  useEffect(() => () => replacePlaybackUrl(null), [replacePlaybackUrl]);

  if (!sessions.length) {
    return null;
  }

  const session = sessions.find((s) => s.clipId === activeClipId) ?? sessions[0] ?? null;

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
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {session?.latencyNote ??
              'Near-live from stream-while-recording parts. Not WebRTC sub-second.'}
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

      <div className="mt-3 overflow-hidden rounded-lg bg-black">
        {playbackUrl ? (
          <video
            ref={videoRef}
            className="aspect-video w-full"
            controls
            playsInline
            autoPlay
            muted
            src={playbackUrl}
          />
        ) : (
          <div className="grid aspect-video place-items-center px-4 text-center text-sm text-white/80">
            {busy
              ? 'Loading latest segments…'
              : 'Waiting for the first uploaded segment (~15–30s after recording starts online).'}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-600">
        {detail?.privacyNote ??
          'Live may show unredacted footage until analysis applies child blur / private-moment ranges after the film is filed.'}
        {detail ? ` · ${detail.partCount} segment${detail.partCount === 1 ? '' : 's'} on hand.` : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
          onClick={() => activeClipId && void loadDetail(activeClipId)}
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
