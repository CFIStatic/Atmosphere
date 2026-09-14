import { useEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../lib/api';
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
 * Keeps the familiar native scrubber (`controls`) and adds YouTube-like
 * mute + volume + closed captions. Captions come from Whisper transcript
 * segments / timestamped transcript_text via a real WebVTT TextTrack —
 * never a fake empty track when nothing was transcribed yet.
 */

export type JobFilePlayerCaptions = {
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
  /** When no VTT yet: pending = mic still being read; unavailable = none. */
  status?: 'pending' | 'unavailable' | null;
};

export function JobFilePlayer({
  src,
  className,
  seekTo,
  seekNonce = 0,
  captions,
  knownDurationSeconds,
  onTimeUpdate,
  testId = 'job-file-player',
}: {
  src: string;
  className?: string;
  seekTo?: number | null;
  seekNonce?: number;
  captions?: JobFilePlayerCaptions | null;
  /** Filed length — skips the WebM dummy-seek duration probe when known. */
  knownDurationSeconds?: number | null;
  /** Throttled playhead seconds for analysis highlight (does not seek). */
  onTimeUpdate?: (seconds: number) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const [volume, setVolume] = useState(() => readVideoPlayerPrefs().volume);
  const [muted, setMuted] = useState(() => readVideoPlayerPrefs().muted);
  const [captionsOn, setCaptionsOn] = useState(() => readVideoPlayerPrefs().captionsOn);

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
    const known = knownDurationSeconds ?? captions?.durationSeconds ?? null;
    return bindMeasuredDuration(el, known);
  }, [src, knownDurationSeconds, captions?.durationSeconds]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onTimeUpdate) return;
    let lastSent = -1;
    const tick = () => {
      const t = el.currentTime;
      if (!Number.isFinite(t)) return;
      // ~4 Hz — enough for SAID/SCENE highlight without React thrash.
      if (Math.abs(t - lastSent) < 0.25) return;
      lastSent = t;
      onTimeUpdate(t);
    };
    el.addEventListener('timeupdate', tick);
    el.addEventListener('seeked', tick);
    el.addEventListener('play', tick);
    return () => {
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('seeked', tick);
      el.removeEventListener('play', tick);
    };
  }, [src, onTimeUpdate]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      setVolume(el.volume);
      setMuted(el.muted);
      writeVideoPlayerPrefs({ volume: el.volume, muted: el.muted });
    };
    el.addEventListener('volumechange', sync);
    return () => el.removeEventListener('volumechange', sync);
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const applyMode = () => {
      const tracks = el.textTracks;
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i]!;
        if (track.kind !== 'captions' && track.kind !== 'subtitles') continue;
        track.mode = captionsAvailable && captionsOn ? 'showing' : 'hidden';
      }
    };
    applyMode();
    const trackEl = trackRef.current;
    if (trackEl) trackEl.addEventListener('load', applyMode);
    return () => {
      if (trackEl) trackEl.removeEventListener('load', applyMode);
    };
  }, [src, vttUrl, captionsOn, captionsAvailable]);

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    writeVideoPlayerPrefs({ muted: nextMuted, volume });
    if (ref.current) ref.current.muted = nextMuted;
  }

  function onVolumeInput(next: number) {
    const clamped = Math.min(1, Math.max(0, next));
    setVolume(clamped);
    const nextMuted = clamped === 0 ? true : false;
    setMuted(nextMuted);
    writeVideoPlayerPrefs({ volume: clamped, muted: nextMuted });
    if (ref.current) {
      ref.current.volume = clamped;
      ref.current.muted = nextMuted;
    }
  }

  function toggleCaptions() {
    if (!captionsAvailable) return;
    const next = !captionsOn;
    setCaptionsOn(next);
    writeVideoPlayerPrefs({ captionsOn: next });
  }

  return (
    <div className="job-file-player" data-testid="job-file-player-shell">
      <video
        ref={ref}
        src={src}
        controls
        playsInline
        preload="metadata"
        data-testid={testId}
        data-seek={seekTo == null ? undefined : String(seekTo)}
        className={className}
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
      <div
        className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-line/80 bg-paper-50/80 px-2 py-1.5"
        data-testid="job-file-player-controls"
      >
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
          aria-pressed={muted || volume === 0}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-700 hover:bg-paper-100"
          data-testid="job-file-mute"
        >
          <SpeakerIcon width={14} height={14} className={muted || volume === 0 ? 'opacity-40' : undefined} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => onVolumeInput(Number(e.target.value))}
          className="h-1.5 w-24 cursor-pointer accent-ink-800"
          data-testid="job-file-volume"
        />
        <button
          type="button"
          onClick={toggleCaptions}
          disabled={!captionsAvailable}
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
          title={captionsAvailable ? undefined : captions?.status === 'pending' ? 'Captions pending' : 'Captions unavailable'}
          className={
            'inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-[11px] font-bold tracking-wide ' +
            (captionsAvailable
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
      </div>
    </div>
  );
}
