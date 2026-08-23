/**
 * How long a clip is, when the file will not say.
 *
 * MediaRecorder writes WebM with no duration in its header. The element then
 * reports 0 or Infinity, the office list prints 0:00, and still extraction
 * divides by it and returns nothing. Seeking past any plausible length forces
 * the browser to scan to the end and work the real time out.
 */

export function measuredDuration(duration: number): number | null {
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/** Clock form the preview badge prints: `1:50`, `1:17:00`. Em-dash when unknown. */
export function formatVideoClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Joined clocks for a day's clips, or null when none are known. */
export function formatClipClocks(
  clips: Array<{ durationSeconds: number | null | undefined }> | undefined,
): string | null {
  const labels = (clips ?? [])
    .map((clip) => formatVideoClock(clip.durationSeconds))
    .filter((label) => label !== '—');
  return labels.length ? labels.join(' · ') : null;
}

export async function resolveElementDuration(
  video: HTMLVideoElement,
  timeoutMs = 8000,
): Promise<number | null> {
  const immediate = measuredDuration(video.duration);
  if (immediate != null) return immediate;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.ontimeupdate = null;
      video.onseeked = null;
      const value = measuredDuration(video.duration);
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    video.ontimeupdate = finish;
    video.onseeked = finish;
    setTimeout(finish, timeoutMs);
    try {
      video.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      finish();
    }
  });
}
