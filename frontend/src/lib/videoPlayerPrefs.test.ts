import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_PLAYER_PREFS,
  VIDEO_PLAYER_PREFS_KEY,
  readVideoPlayerPrefs,
  writeVideoPlayerPrefs,
} from './videoPlayerPrefs';

describe('videoPlayerPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults like a normal unmuted player', () => {
    expect(readVideoPlayerPrefs()).toEqual(DEFAULT_VIDEO_PLAYER_PREFS);
  });

  it('persists volume, mute, and captions preference', () => {
    writeVideoPlayerPrefs({ volume: 0.4, muted: true, captionsOn: false });
    expect(JSON.parse(localStorage.getItem(VIDEO_PLAYER_PREFS_KEY) || '{}')).toMatchObject({
      volume: 0.4,
      muted: true,
      captionsOn: false,
    });
    expect(readVideoPlayerPrefs()).toEqual({ volume: 0.4, muted: true, captionsOn: false });
  });

  it('clamps volume into 0..1', () => {
    expect(writeVideoPlayerPrefs({ volume: 2 }).volume).toBe(1);
    expect(writeVideoPlayerPrefs({ volume: -1 }).volume).toBe(0);
  });
});
