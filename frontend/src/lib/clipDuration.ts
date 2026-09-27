/**
 * How long a filed clip actually is.
 *
 * MediaRecorder WebM often reports 0 or Infinity, and a 50-minute day film
 * must not print as 0:00 — or as 3000s. These helpers keep the measurement
 * honest (0 is unknown, not a length) and the label in the unit a person
 * would say: 10 seconds, 50 minutes, 1 hour 20 minutes.
 */

export function isKnownDuration(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/** First candidate that is a real length. 0 and Infinity never win. */
export function knownDurationSeconds(
  ...candidates: Array<number | null | undefined>
): number | null {
  for (const value of candidates) {
    if (isKnownDuration(value)) return Number(value);
  }
  return null;
}

/**
 * Spoken length for lists and the door after upload.
 * 10 → "10 seconds"; 3000 → "50 minutes".
 */
export function formatClipLength(seconds: number | null | undefined): string {
  const total = knownDurationSeconds(seconds);
  if (total == null) return '—';
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  const parts: string[] = [];
  if (hours) parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  if (minutes) parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
  if (!hours && !minutes) parts.push(rest === 1 ? '1 second' : `${rest} seconds`);
  else if (!hours && rest) parts.push(rest === 1 ? '1 second' : `${rest} seconds`);
  return parts.join(' ');
}

/** Compact clock for dense tables and player badges. */
export function formatClipClock(seconds: number | null | undefined): string {
  const total = knownDurationSeconds(seconds);
  if (total == null) return '—';
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * A browser-recorded WebM has no duration in its header. Seeking past the
 * end forces the element to scan the file so the native player shows 0:10
 * or 50:00 instead of 0:00 / Infinity.
 */
export function bindMeasuredDuration(
  video: HTMLVideoElement,
  knownSeconds?: number | null,
): () => void {
  let cancelled = false;

  const measured = () =>
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

  const onPause = () => discover();
  // The file is only preloading. Clear this on Play so the probe can run
  // once the viewer pauses — not while the first press is in flight.
  const onPlay = () => {
    if (video.dataset) delete video.dataset.atmPreload;
  };

  const discover = () => {
    if (cancelled || measured() != null) return;
    if (isKnownDuration(knownSeconds)) return;
    const dataset = video.dataset;
    // Visible players with native controls. A dummy seek during Play
    // flashes the last frame and restarts the clip.
    if (
      !video.paused ||
      (dataset && dataset.playingSoon === '1') ||
      (dataset && dataset.atmPreload === '1')
    ) {
      video.addEventListener('pause', onPause, { once: true });
      return;
    }
    const origin = video.currentTime;
    const settle = () => {
      video.removeEventListener('seeked', settle);
      video.removeEventListener('timeupdate', settle);
      if (cancelled) return;
      try {
        const length = measured();
        const atProbe =
          video.currentTime === Number.MAX_SAFE_INTEGER ||
          (length != null && video.currentTime >= length - 0.35);
        // Play began on top of the probe. The seek parked the head at the
        // end; put it back. A playhead that already moved stays where it is.
        if (!video.paused && !atProbe) return;
        video.currentTime = origin;
      } catch {
        /* the playhead is decorative until the user presses play */
      }
    };
    video.addEventListener('seeked', settle);
    video.addEventListener('timeupdate', settle);
    try {
      video.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      video.removeEventListener('seeked', settle);
      video.removeEventListener('timeupdate', settle);
    }
  };

  video.addEventListener('play', onPlay);
  video.addEventListener('loadedmetadata', discover);
  if (video.readyState >= 1) discover();

  return () => {
    cancelled = true;
    video.removeEventListener('loadedmetadata', discover);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('play', onPlay);
  };
}
