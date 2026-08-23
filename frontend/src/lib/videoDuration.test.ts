import { describe, expect, it } from 'vitest';
import { formatVideoClock, measuredDuration } from './videoDuration';

describe('measuredDuration', () => {
  it('keeps a real length and drops placeholders', () => {
    expect(measuredDuration(143.2)).toBe(143.2);
    expect(measuredDuration(0)).toBeNull();
    expect(measuredDuration(Infinity)).toBeNull();
    expect(measuredDuration(Number.NaN)).toBeNull();
  });
});

describe('formatVideoClock', () => {
  it('prints minutes, then hours, and an em dash when unknown', () => {
    expect(formatVideoClock(12)).toBe('0:12');
    expect(formatVideoClock(110)).toBe('1:50');
    expect(formatVideoClock(4620)).toBe('1:17:00');
    expect(formatVideoClock(0)).toBe('—');
    expect(formatVideoClock(null)).toBe('—');
  });
});
