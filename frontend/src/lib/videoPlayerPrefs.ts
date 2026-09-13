/**
 * Device-local playback preferences for job-file / library video players.
 * Volume + mute persist like common players (YouTube-style).
 */

export type VideoPlayerPrefs = {
  /** 0..1 linear volume. */
  volume: number;
  muted: boolean;
  /** Captions on when a track exists. */
  captionsOn: boolean;
};

export const VIDEO_PLAYER_PREFS_KEY = 'atmosphere.videoPlayer';

export const DEFAULT_VIDEO_PLAYER_PREFS: VideoPlayerPrefs = {
  volume: 1,
  muted: false,
  captionsOn: true,
};

function clampVolume(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VIDEO_PLAYER_PREFS.volume;
  return Math.min(1, Math.max(0, n));
}

export function readVideoPlayerPrefs(): VideoPlayerPrefs {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_VIDEO_PLAYER_PREFS };
    const raw = window.localStorage.getItem(VIDEO_PLAYER_PREFS_KEY);
    if (!raw) return { ...DEFAULT_VIDEO_PLAYER_PREFS };
    const parsed = JSON.parse(raw) as Partial<VideoPlayerPrefs>;
    return {
      volume: clampVolume(parsed.volume),
      muted: Boolean(parsed.muted),
      captionsOn: parsed.captionsOn == null ? true : Boolean(parsed.captionsOn),
    };
  } catch {
    return { ...DEFAULT_VIDEO_PLAYER_PREFS };
  }
}

export function writeVideoPlayerPrefs(next: Partial<VideoPlayerPrefs>): VideoPlayerPrefs {
  const merged: VideoPlayerPrefs = {
    ...readVideoPlayerPrefs(),
    ...next,
    volume: next.volume != null ? clampVolume(next.volume) : readVideoPlayerPrefs().volume,
  };
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIDEO_PLAYER_PREFS_KEY, JSON.stringify(merged));
    }
  } catch {
    /* private mode / quota — preference is best-effort */
  }
  return merged;
}

/** Apply stored prefs onto a media element without firing a persist loop. */
export function applyVideoPlayerPrefs(el: HTMLMediaElement, prefs = readVideoPlayerPrefs()): void {
  el.volume = prefs.volume;
  el.muted = prefs.muted;
}
