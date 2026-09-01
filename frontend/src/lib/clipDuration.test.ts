import { describe, expect, it } from 'vitest';
import {
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
