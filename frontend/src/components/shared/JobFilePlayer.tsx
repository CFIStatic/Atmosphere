import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChildPrivacyRedactionRange,
  PrivacyRedactionRange,
  TranscriptSegment,
} from '../../lib/api';
import { bindMeasuredDuration } from '../../lib/clipDuration';
import { webVttFromTranscript } from '../../lib/transcriptCaptions';
import {
  applyVideoPlayerPrefs,
  readVideoPlayerPrefs,
  writeVideoPlayerPrefs,
} from '../../lib/videoPlayerPrefs';
import { SpeakerIcon } from '../icons';

/**
 * Shared job-file / office video player.
 *
 * One chrome: an orange scrubber on the picture, then play, volume, time,
 * captions, and fullscreen. The browser's native bar is not used — it
 * stacked a second progress line on top of this one. Captions come from
 * Whisper transcript segments / timestamped transcript_text via a real
 * WebVTT TextTrack — never a fake empty track when nothing was transcribed yet.
 *
 * Phase 1 privacy: private-moment ranges force mute + heavy blur. Child
 * privacy ranges prefer region blur (no mute) when boxes exist; otherwise
 * full-frame blur + mute. Seeking into a range stays redacted. Server-side
 * re-encode is phase 2.
 */

export type JobFilePlayerCaptions = {
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
  /** When no VTT yet: pending = mic still being read; unavailable = none. */
  status?: 'pending' | 'unavailable' | null;
};

export function activePrivacyRange(
  tSec: number,
  ranges: PrivacyRedactionRange[] | null | undefined,
): PrivacyRedactionRange | null {
  if (!Number.isFinite(tSec) || !ranges?.length) return null;
  for (const r of ranges) {
    if (tSec >= r.startSec && tSec < r.endSec) return r;
    if (Math.abs(tSec - r.endSec) < 0.05) return r;
  }
  return null;
}

export type ActivePrivacy =
  | { kind: 'private'; range: PrivacyRedactionRange }
  | { kind: 'child'; range: ChildPrivacyRedactionRange };

export function activeChildPrivacyRange(
  tSec: number,
  ranges: ChildPrivacyRedactionRange[] | null | undefined,
): ChildPrivacyRedactionRange | null {
  if (!Number.isFinite(tSec) || !ranges?.length) return null;
  for (const r of ranges) {
    if (tSec >= r.startSec && tSec < r.endSec) return r;
    if (Math.abs(tSec - r.endSec) < 0.05) return r;
  }
  return null;
}

/** Private moments take priority; then child privacy. */
export function resolveActivePrivacy(
  tSec: number,
  privateRanges: PrivacyRedactionRange[] | null | undefined,
  childRanges: ChildPrivacyRedactionRange[] | null | undefined,
): ActivePrivacy | null {
  const priv = activePrivacyRange(tSec, privateRanges);
  if (priv) return { kind: 'private', range: priv };
  const child = activeChildPrivacyRange(tSec, childRanges);
  if (child) return { kind: 'child', range: child };
  return null;
}

export function childRangeUsesRegionBlur(range: ChildPrivacyRedactionRange | null | undefined): boolean {
  return Boolean(range?.regions && range.regions.length > 0);
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function bufferedRatio(el: HTMLVideoElement): number {
  const duration = el.duration;
  if (!Number.isFinite(duration) || duration <= 0 || !el.buffered?.length) return 0;
  let end = 0;
  const t = el.currentTime || 0;
  for (let i = 0; i < el.buffered.length; i += 1) {
    const start = el.buffered.start(i);
    const stop = el.buffered.end(i);
    if (start - 0.05 <= t && t <= stop + 0.05) return Math.min(1, stop / duration);
    if (stop > end) end = stop;
  }
  return Math.min(1, end / duration);
}

export function JobFilePlayer({
  src,
  className,
  seekTo,
  seekNonce = 0,
  captions,
  knownDurationSeconds,
  privacyRedactions,
  childPrivacyRedactions,
  onTimeUpdate,
  onPlaybackError,
  poster,
  resumeAt,
  resumePlaying = false,
  testId = 'job-file-player',
}: {
  src: string;
  className?: string;
  seekTo?: number | null;
  seekNonce?: number;
  captions?: JobFilePlayerCaptions | null;
  /** Filed length — skips the WebM dummy-seek duration probe when known. */
  knownDurationSeconds?: number | null;
  /** Stored ai_findings.privacyRedactions ranges — blur + mute while active. */
  privacyRedactions?: PrivacyRedactionRange[] | null;
  /** Child privacy ranges — region blur when boxes exist; else full-frame blur+mute. */
  childPrivacyRedactions?: ChildPrivacyRedactionRange[] | null;
  /** Throttled playhead seconds for analysis highlight (does not seek). */
  onTimeUpdate?: (seconds: number) => void;
  /** Signed URL expired or the element failed. Parent remints and passes a new src. */
  onPlaybackError?: (info: { currentTime: number; wasPlaying: boolean }) => void;
  /** First-frame still so the player is never a blank rectangle. */
  poster?: string | null;
  /** After a reminted src, continue at this time. */
  resumeAt?: number | null;
  resumePlaying?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const trackRef = useRef<HTMLTrackElement>(null);
  const prefsMutedRef = useRef(readVideoPlayerPrefs().muted);
  const [volume, setVolume] = useState(() => readVideoPlayerPrefs().volume);
  const [muted, setMuted] = useState(() => readVideoPlayerPrefs().muted);
  const [captionsOn, setCaptionsOn] = useState(() => readVideoPlayerPrefs().captionsOn);
  const [privacyActive, setPrivacyActive] = useState<ActivePrivacy | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState({ at: 0, duration: 0, buffered: 0 });

  const ranges = privacyRedactions ?? null;
  const childRanges = childPrivacyRedactions ?? null;
  const forceMute =
    privacyActive?.kind === 'private' ||
    (privacyActive?.kind === 'child' && !childRangeUsesRegionBlur(privacyActive.range));
  const fullFrameBlur =
    privacyActive?.kind === 'private' ||
    (privacyActive?.kind === 'child' && !childRangeUsesRegionBlur(privacyActive.range));
  const regionBlur =
    privacyActive?.kind === 'child' && childRangeUsesRegionBlur(privacyActive.range)
      ? privacyActive.range.regions ?? []
      : [];

  const vtt = useMemo(
    () =>
      webVttFromTranscript({
        segments: captions?.segments,
        transcriptText: captions?.transcriptText,
        durationSeconds: captions?.durationSeconds,
      }),
    [captions?.segments, captions?.transcriptText, captions?.durationSeconds],
  );
  const vttUrl = useMemo(() => {
    if (!vtt) return null;
    return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  }, [vtt]);
  const captionsAvailable = Boolean(vttUrl);

  useEffect(() => {
    return () => {
      if (vttUrl) URL.revokeObjectURL(vttUrl);
    };
  }, [vttUrl]);

  useEffect(() => {
    const el = ref.current;
    if (!el || seekTo == null || !Number.isFinite(seekTo)) return;
    // Do not scrollIntoView the video — that can yank the page and fight
    // the analysis panel / auto-pause the player in some browsers.
    const apply = () => {
      try {
        el.currentTime = seekTo;
      } catch {
        /* playhead is decorative until the browser can seek */
      }
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [src, seekTo, seekNonce]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    applyVideoPlayerPrefs(el);
    // Preload without a dummy seek-to-end. That seek races the first Play
    // and leaves the playhead on the last frame. Once playback has started,
    // a later pause is allowed to measure.
    if (el.paused) el.dataset.atmPreload = '1';
    const known = knownDurationSeconds ?? captions?.durationSeconds ?? null;
    return bindMeasuredDuration(el, known);
  }, [src, knownDurationSeconds, captions?.durationSeconds]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWaiting = () => {
      if (!el.paused) setBuffering(true);
    };
    const onPlay = () => {
      if (el.readyState < 3) setBuffering(true);
    };
    const onPlaying = () => {
      setBuffering(false);
      setPlayError(null);
    };
    const onPause = () => setBuffering(false);
    const onCanPlay = () => {
      if (!el.paused) setBuffering(false);
    };
    const onError = () => {
      setBuffering(false);
      const at = Number.isFinite(el.currentTime) ? el.currentTime : 0;
      const wasPlaying = !el.paused;
      if (onPlaybackError) onPlaybackError({ currentTime: at, wasPlaying });
      else setPlayError('Could not play this file. Tap play to try again.');
    };
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('stalled', onWaiting);
    el.addEventListener('play', onPlay);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('stalled', onWaiting);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
    };
  }, [src, onPlaybackError]);

  useEffect(() => {
    const el = ref.current;
    if (!el || resumeAt == null || !Number.isFinite(resumeAt)) return;
    const apply = () => {
      try {
        el.currentTime = resumeAt;
      } catch {
        /* playhead waits until the browser can seek */
      }
      if (!resumePlaying) return;
      const attempt = el.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          setPlayError('Tap play to start.');
        });
      }
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [src, resumeAt, resumePlaying]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastSent = -1;
    const tick = () => {
      const t = el.currentTime;
      if (!Number.isFinite(t)) return;
      const active = resolveActivePrivacy(t, ranges, childRanges);
      setPrivacyActive((prev) => {
        if (
          prev?.kind === active?.kind &&
          prev?.range.startSec === active?.range.startSec &&
          prev?.range.endSec === active?.range.endSec
        ) {
          return prev;
        }
        return active;
      });
      const shouldMute =
        active?.kind === 'private' ||
        (active?.kind === 'child' && !childRangeUsesRegionBlur(active.range));
      if (shouldMute) {
        el.muted = true;
      } else {
        el.muted = prefsMutedRef.current || volume === 0;
      }
      if (onTimeUpdate) {
        if (Math.abs(t - lastSent) < 0.25) return;
        lastSent = t;
        onTimeUpdate(t);
      }
    };
    el.addEventListener('timeupdate', tick);
    el.addEventListener('seeked', tick);
    el.addEventListener('play', tick);
    tick();
    return () => {
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('seeked', tick);
      el.removeEventListener('play', tick);
    };
  }, [src, onTimeUpdate, ranges, childRanges, volume]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = volume;
    if (!forceMute) {
      el.muted = muted;
    }
  }, [volume, muted, forceMute]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      // Ignore mute flips forced by privacy enforcement.
      if (forceMute) return;
      setVolume(el.volume);
      setMuted(el.muted);
      prefsMutedRef.current = el.muted;
      writeVideoPlayerPrefs({ volume: el.volume, muted: el.muted });
    };
    el.addEventListener('volumechange', sync);
    return () => el.removeEventListener('volumechange', sync);
  }, [src, forceMute]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const applyMode = () => {
      const tracks = el.textTracks;
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i]!;
        if (track.kind !== 'captions' && track.kind !== 'subtitles') continue;
        // Hide captions while privacy-protected so on-screen speech is not leaked.
        track.mode =
          captionsAvailable && captionsOn && !forceMute ? 'showing' : 'hidden';
      }
    };
    applyMode();
    const trackEl = trackRef.current;
    if (trackEl) trackEl.addEventListener('load', applyMode);
    return () => {
      if (trackEl) trackEl.removeEventListener('load', applyMode);
    };
  }, [src, vttUrl, captionsOn, captionsAvailable, forceMute]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      setClock({
        at: Number.isFinite(el.currentTime) ? el.currentTime : 0,
        duration,
        buffered: bufferedRatio(el),
      });
      setPlaying(!el.paused && !el.ended);
    };
    el.addEventListener('timeupdate', sync);
    el.addEventListener('progress', sync);
    el.addEventListener('durationchange', sync);
    el.addEventListener('loadedmetadata', sync);
    el.addEventListener('seeked', sync);
    el.addEventListener('play', sync);
    el.addEventListener('pause', sync);
    el.addEventListener('ended', sync);
    sync();
    return () => {
      el.removeEventListener('timeupdate', sync);
      el.removeEventListener('progress', sync);
      el.removeEventListener('durationchange', sync);
      el.removeEventListener('loadedmetadata', sync);
      el.removeEventListener('seeked', sync);
      el.removeEventListener('play', sync);
      el.removeEventListener('pause', sync);
      el.removeEventListener('ended', sync);
    };
  }, [src]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  function togglePlay() {
    const el = ref.current;
    if (!el) return;
    const stalledAtStart = el.readyState < 3 && (el.currentTime || 0) < 0.35;
    if (!el.paused && !el.ended && !stalledAtStart) {
      el.pause();
      return;
    }
    setPlayError(null);
    const attempt = el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        setPlayError('Tap play to start.');
      });
    }
  }

  function seekToRatio(clientX: number, surface: HTMLElement) {
    const video = ref.current;
    const rect = surface.getBoundingClientRect();
    if (!video || !rect.width) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : clock.duration;
    if (!(duration > 0)) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const at = ratio * duration;
    try {
      video.currentTime = at;
    } catch {
      /* playhead waits until the browser can seek */
    }
    setClock((prev) => ({ ...prev, at, duration }));
  }

  function onScrubDown(ev: React.PointerEvent<HTMLDivElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    scrubbingRef.current = true;
    setScrubbing(true);
    ev.currentTarget.setPointerCapture(ev.pointerId);
    seekToRatio(ev.clientX, ev.currentTarget);
  }

  function onScrubMove(ev: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbingRef.current) return;
    seekToRatio(ev.clientX, ev.currentTarget);
  }

  function onScrubUp(ev: React.PointerEvent<HTMLDivElement>) {
    scrubbingRef.current = false;
    setScrubbing(false);
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
  }

  function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) {
      void document.exitFullscreen();
      return;
    }
    void shell.requestFullscreen();
  }

  function onShellKeyDown(ev: React.KeyboardEvent) {
    if (ev.key !== ' ' && ev.code !== 'Space') return;
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    ev.preventDefault();
    togglePlay();
  }

  function toggleMute() {
    if (forceMute) return; // cannot unmute through a full-frame privacy range
    const nextMuted = !muted;
    setMuted(nextMuted);
    prefsMutedRef.current = nextMuted;
    writeVideoPlayerPrefs({ muted: nextMuted, volume });
    if (ref.current) ref.current.muted = nextMuted;
  }

  function onVolumeInput(next: number) {
    const clamped = Math.min(1, Math.max(0, next));
    setVolume(clamped);
    const nextMuted = clamped === 0 ? true : false;
    setMuted(nextMuted);
    prefsMutedRef.current = nextMuted;
    writeVideoPlayerPrefs({ volume: clamped, muted: nextMuted });
    if (ref.current) {
      ref.current.volume = clamped;
      if (!forceMute) ref.current.muted = nextMuted;
    }
  }

  function toggleCaptions() {
    if (!captionsAvailable) return;
    const next = !captionsOn;
    setCaptionsOn(next);
    writeVideoPlayerPrefs({ captionsOn: next });
  }

  const durationShown = clock.duration > 0 ? clock.duration : (knownDurationSeconds ?? 0);
  const played = durationShown > 0 ? Math.min(1, Math.max(0, clock.at / durationShown)) : 0;

  return (
    <div
      ref={shellRef}
      className="job-file-player"
      data-testid="job-file-player-shell"
      onKeyDown={onShellKeyDown}
    >
      <div className="job-file-player-stage relative">
        <video
          ref={ref}
          src={src}
          poster={poster || undefined}
          controls={false}
          playsInline
          disablePictureInPicture
          controlsList="nodownload noplaybackrate nofullscreen"
          preload="auto"
          {...{ 'webkit-playsinline': 'true' }}
          data-testid={testId}
          data-seek={seekTo == null ? undefined : String(seekTo)}
          data-privacy-active={privacyActive ? '1' : '0'}
          data-privacy-kind={privacyActive?.kind ?? undefined}
          className={
            (className ?? '') +
            (fullFrameBlur ? ' job-file-player-privacy-blur' : '')
          }
          onClick={togglePlay}
        >
          {vttUrl ? (
            <track
              ref={trackRef}
              kind="captions"
              srcLang="en"
              label="Captions"
              src={vttUrl}
              default={captionsOn}
            />
          ) : null}
        </video>
        {buffering ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            data-testid="job-file-buffer"
            role="status"
            aria-label="Loading video"
          >
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-orange-500" />
          </div>
        ) : null}
        {playError ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
            data-testid="job-file-play-error"
            role="alert"
          >
            <span className="rounded-full bg-ink-900/80 px-2.5 py-1 text-[11px] font-medium text-paper-50">
              {playError}
            </span>
          </div>
        ) : null}
        {regionBlur.length
          ? regionBlur.map((box, i) => (
              <div
                key={`child-region-${i}`}
                className="job-file-player-child-region-blur pointer-events-none absolute"
                data-testid="job-file-child-region-blur"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
                aria-hidden="true"
              />
            ))
          : null}
        <div
          className={'job-file-scrub' + (scrubbing ? ' is-dragging' : '')}
          data-testid="job-file-scrub"
          role="slider"
          aria-label="Playback progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(played * 100)}
          tabIndex={0}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onKeyDown={(ev) => {
            if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
            ev.preventDefault();
            ev.stopPropagation();
            const video = ref.current;
            if (!video || !(durationShown > 0)) return;
            const next = Math.min(durationShown, Math.max(0, (video.currentTime || 0) + (ev.key === 'ArrowRight' ? 5 : -5)));
            try {
              video.currentTime = next;
            } catch {
              /* playhead waits until the browser can seek */
            }
          }}
        >
          <div className="job-file-scrub-track">
            <div className="job-file-scrub-buffer" style={{ transform: `scaleX(${clock.buffered})` }} />
            <div className="job-file-scrub-fill" style={{ transform: `scaleX(${played})` }} />
          </div>
          <div className="job-file-scrub-thumb" style={{ left: `${played * 100}%` }} />
        </div>
        {privacyActive ? (
          <div
            className="job-file-player-privacy-veil pointer-events-none absolute inset-0 flex items-end justify-start p-2"
            data-testid="job-file-privacy-veil"
            aria-hidden="true"
          >
            <span
              className="rounded-full bg-ink-900/75 px-2 py-0.5 text-[10px] font-medium tracking-wide text-paper-50"
              data-testid="job-file-privacy-badge"
            >
              {privacyActive.kind === 'child' ? 'Child privacy' : 'Privacy protected'}
            </span>
          </div>
        ) : null}
      </div>
      <div
        className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-line/80 bg-paper-50/80 px-2 py-1.5"
        data-testid="job-file-player-controls"
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-700 hover:bg-paper-100"
          data-testid="job-file-play"
        >
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={
            forceMute
              ? 'Muted — privacy protected'
              : muted || volume === 0
                ? 'Unmute'
                : 'Mute'
          }
          aria-pressed={Boolean(forceMute) || muted || volume === 0}
          disabled={Boolean(forceMute)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-700 hover:bg-paper-100 disabled:opacity-50"
          data-testid="job-file-mute"
        >
          <SpeakerIcon
            width={14}
            height={14}
            className={forceMute || muted || volume === 0 ? 'opacity-40' : undefined}
          />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={forceMute || muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => onVolumeInput(Number(e.target.value))}
          className="h-1.5 w-24 cursor-pointer accent-ink-800"
          data-testid="job-file-volume"
        />
        <button
          type="button"
          onClick={toggleCaptions}
          disabled={!captionsAvailable || Boolean(forceMute)}
          aria-label={
            captionsAvailable
              ? captionsOn
                ? 'Turn captions off'
                : 'Turn captions on'
              : captions?.status === 'pending'
                ? 'Captions pending'
                : 'Captions unavailable'
          }
          aria-pressed={captionsAvailable ? captionsOn : undefined}
          title={
            forceMute
              ? 'Captions hidden while privacy-protected'
              : captionsAvailable
                ? undefined
                : captions?.status === 'pending'
                  ? 'Captions pending'
                  : 'Captions unavailable'
          }
          className={
            'inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-[11px] font-bold tracking-wide ' +
            (captionsAvailable && !forceMute
              ? captionsOn
                ? 'bg-ink-900 text-paper-50'
                : 'text-ink-700 hover:bg-paper-100'
              : 'cursor-not-allowed text-ink-400')
          }
          data-testid="job-file-cc"
        >
          CC
        </button>
        {!captionsAvailable ? (
          <span className="text-[11px] text-ink-500" data-testid="job-file-cc-unavailable">
            {captions?.status === 'pending' ? 'Captions pending' : 'Captions unavailable'}
          </span>
        ) : null}
        {ranges?.length || childRanges?.length ? (
          <span
            className="text-[10px] text-ink-400"
            data-testid="job-file-privacy-hint"
            title={[
              ...(ranges ?? []).map(
                (r) => `${r.startSec.toFixed(0)}s–${r.endSec.toFixed(0)}s · ${r.reason}`,
              ),
              ...(childRanges ?? []).map(
                (r) => `${r.startSec.toFixed(0)}s–${r.endSec.toFixed(0)}s · child · ${r.reason}`,
              ),
            ].join('\n')}
          >
            Privacy-protected segments on file
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-500" data-testid="job-file-time">
          {formatClock(clock.at)} / {formatClock(durationShown)}
        </span>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-700 hover:bg-paper-100"
          data-testid="job-file-fullscreen"
        >
          {fullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
