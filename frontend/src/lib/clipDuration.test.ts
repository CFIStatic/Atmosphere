import { describe, expect, it } from 'vitest';
import {
  bindMeasuredDuration,
  formatClipClock,
  formatClipLength,
  isKnownDuration,
  knownDurationSeconds,
} from './clipDuration';

describe('knownDurationSeconds', () => {
  it('rejects 0, Infinity, and missing values — those are unknown, not a length', () => {
    expect(isKnownDuration(0)).toBe(false);
    expect(isKnownDuration(Number.POSITIVE_INFINITY)).toBe(false);
    expect(knownDurationSeconds(0, null, undefined, Number.NaN)).toBeNull();
  });

  it('keeps the first real clock so a 50-minute film is not lost to a 0:00 header', () => {
    expect(knownDurationSeconds(0, 3000, 10)).toBe(3000);
    expect(knownDurationSeconds(10)).toBe(10);
    expect(knownDurationSeconds(null, 10.4)).toBe(10.4);
  });
});

describe('formatClipLength', () => {
  it('names a 10-second clip in seconds', () => {
    expect(formatClipLength(10)).toBe('10 seconds');
    expect(formatClipLength(1)).toBe('1 second');
  });

  it('names a 50-minute clip in minutes', () => {
    expect(formatClipLength(50 * 60)).toBe('50 minutes');
    expect(formatClipLength(1 * 60)).toBe('1 minute');
    expect(formatClipLength(50 * 60 + 8)).toBe('50 minutes 8 seconds');
  });

  it('adds hours when the day film is that long', () => {
    expect(formatClipLength(3600)).toBe('1 hour');
    expect(formatClipLength(2 * 3600 + 5 * 60)).toBe('2 hours 5 minutes');
  });

  it('renders an em dash when the clock was never measured', () => {
    expect(formatClipLength(null)).toBe('—');
    expect(formatClipLength(0)).toBe('—');
  });
});

describe('formatClipClock', () => {
  it('prints short clips as m:ss and long ones with hours', () => {
    expect(formatClipClock(10)).toBe('0:10');
    expect(formatClipClock(50 * 60)).toBe('50:00');
    expect(formatClipClock(3661)).toBe('1:01:01');
    expect(formatClipClock(0)).toBe('—');
  });
});

type FakeVideo = HTMLVideoElement & {
  dispatch(type: string): void;
};

function fakeVideo(init: {
  duration?: number;
  paused?: boolean;
  currentTime?: number;
  readyState?: number;
}): FakeVideo {
  const listeners = new Map<string, Set<EventListener>>();
  const video = {
    duration: init.duration ?? Number.POSITIVE_INFINITY,
    paused: init.paused ?? true,
    currentTime: init.currentTime ?? 0,
    readyState: init.readyState ?? 0,
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn(new Event(type));
      }
    },
  };
  return video as FakeVideo;
}

describe('bindMeasuredDuration', () => {
  it('does not seek a clip the user is already watching', () => {
    const video = fakeVideo({ paused: false, currentTime: 3.2, readyState: 1 });
    bindMeasuredDuration(video);
    expect(video.currentTime).toBe(3.2);
  });

  it('puts a paused playhead back where it was, not always at 0', () => {
    const video = fakeVideo({ currentTime: 4, readyState: 1 });
    bindMeasuredDuration(video);
    expect(video.currentTime).toBe(Number.MAX_SAFE_INTEGER);
    video.duration = 10;
    video.currentTime = 10;
    video.dispatch('seeked');
    expect(video.currentTime).toBe(4);
  });

  it('leaves the playhead alone if Play starts before the dummy seek settles', () => {
    const video = fakeVideo({ readyState: 1 });
    bindMeasuredDuration(video);
    expect(video.currentTime).toBe(Number.MAX_SAFE_INTEGER);
    video.paused = false;
    video.duration = 10;
    video.currentTime = 2.5;
    video.dispatch('timeupdate');
    expect(video.currentTime).toBe(2.5);
  });

  it('scans after Pause when metadata arrived during Play', () => {
    const video = fakeVideo({ paused: false, currentTime: 1.5, readyState: 1 });
    bindMeasuredDuration(video);
    expect(video.currentTime).toBe(1.5);

    video.paused = true;
    video.dispatch('pause');
    expect(video.currentTime).toBe(Number.MAX_SAFE_INTEGER);

    video.duration = 12;
    video.currentTime = 12;
    video.dispatch('seeked');
    expect(video.currentTime).toBe(1.5);
  });

  it('skips discovery when the header already has a real length', () => {
    const video = fakeVideo({ duration: 10, readyState: 1 });
    bindMeasuredDuration(video);
    expect(video.currentTime).toBe(0);
  });

  it('skips the dummy seek when the filed clip already has a measured length', () => {
    const video = fakeVideo({ duration: Number.POSITIVE_INFINITY, readyState: 1 });
    bindMeasuredDuration(video, 33);
    expect(video.currentTime).toBe(0);
  });
});
