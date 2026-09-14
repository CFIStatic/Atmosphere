import { useEffect, useMemo, useRef, useState } from 'react';
import type { PrivacyRedactionRange, TranscriptSegment } from '../../lib/api';
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
 *
 * Phase 1 privacy: when `privacyRedactions` are present, force mute + heavy
 * blur (or blackout) while the playhead is inside a range. Seeking into a
 * range stays redacted. Server-side re-encode is phase 2.
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

export function JobFilePlayer({
  src,
  className,
  seekTo,
  seekNonce = 0,
  captions,
  knownDurationSeconds,
  privacyRedactions,
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
  /** Stored ai_findings.privacyRedactions ranges — blur + mute while active. */
  privacyRedactions?: PrivacyRedactionRange[] | null;
  /** Throttled playhead seconds for analysis highlight (does not seek). */
  onTimeUpdate?: (seconds: number) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const prefsMutedRef = useRef(readVideoPlayerPrefs().muted);
  const [volume, setVolume] = useState(() => readVideoPlayerPrefs().volume);
  const [muted, setMuted] = useState(() => readVideoPlayerPrefs().muted);
  const [captionsOn, setCaptionsOn] = useState(() => readVideoPlayerPrefs().captionsOn);
  const [privacyActive, setPrivacyActive] = useState<PrivacyRedactionRange | null>(null);

  const ranges = privacyRedactions ?? null;

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
    if (!el) return;
    let lastSent = -1;
    const tick = () => {
      const t = el.currentTime;
      if (!Number.isFinite(t)) return;
      const active = activePrivacyRange(t, ranges);
      setPrivacyActive((prev) => {
        if (prev?.startSec === active?.startSec && prev?.endSec === active?.endSec) return prev;
        return active;
      });
      // Force mute inside private ranges; restore user preference outside.
      if (active) {
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
  }, [src, onTimeUpdate, ranges, volume]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = volume;
    if (!privacyActive) {
      el.muted = muted;
    }
  }, [volume, muted, privacyActive]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      // Ignore mute flips forced by privacy enforcement.
      if (privacyActive) return;
      setVolume(el.volume);
      setMuted(el.muted);
      prefsMutedRef.current = el.muted;
      writeVideoPlayerPrefs({ volume: el.volume, muted: el.muted });
    };
    el.addEventListener('volumechange', sync);
    return () => el.removeEventListener('volumechange', sync);
  }, [src, privacyActive]);

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
          captionsAvailable && captionsOn && !privacyActive ? 'showing' : 'hidden';
      }
    };
    applyMode();
    const trackEl = trackRef.current;
    if (trackEl) trackEl.addEventListener('load', applyMode);
    return () => {
      if (trackEl) trackEl.removeEventListener('load', applyMode);
    };
  }, [src, vttUrl, captionsOn, captionsAvailable, privacyActive]);

  function toggleMute() {
    if (privacyActive) return; // cannot unmute through a private range
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
      if (!privacyActive) ref.current.muted = nextMuted;
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
      <div className="job-file-player-stage relative">
        <video
          ref={ref}
          src={src}
          controls
          playsInline
          preload="metadata"
          data-testid={testId}
          data-seek={seekTo == null ? undefined : String(seekTo)}
          data-privacy-active={privacyActive ? '1' : '0'}
          className={
            (className ?? '') +
            (privacyActive ? ' job-file-player-privacy-blur' : '')
          }
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
              Privacy protected
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
          onClick={toggleMute}
          aria-label={
            privacyActive
              ? 'Muted — privacy protected'
              : muted || volume === 0
                ? 'Unmute'
                : 'Mute'
          }
          aria-pressed={Boolean(privacyActive) || muted || volume === 0}
          disabled={Boolean(privacyActive)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-700 hover:bg-paper-100 disabled:opacity-50"
          data-testid="job-file-mute"
        >
          <SpeakerIcon
            width={14}
            height={14}
            className={privacyActive || muted || volume === 0 ? 'opacity-40' : undefined}
          />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={privacyActive || muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => onVolumeInput(Number(e.target.value))}
          className="h-1.5 w-24 cursor-pointer accent-ink-800"
          data-testid="job-file-volume"
        />
        <button
          type="button"
          onClick={toggleCaptions}
          disabled={!captionsAvailable || Boolean(privacyActive)}
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
            privacyActive
              ? 'Captions hidden while privacy-protected'
              : captionsAvailable
                ? undefined
                : captions?.status === 'pending'
                  ? 'Captions pending'
                  : 'Captions unavailable'
          }
          className={
            'inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-[11px] font-bold tracking-wide ' +
            (captionsAvailable && !privacyActive
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
        {ranges?.length ? (
          <span
            className="ml-auto text-[10px] text-ink-400"
            data-testid="job-file-privacy-hint"
            title={ranges.map((r) => `${r.startSec.toFixed(0)}s–${r.endSec.toFixed(0)}s · ${r.reason}`).join('\n')}
          >
            Privacy-protected segments on file
          </span>
        ) : null}
      </div>
    </div>
  );
}
