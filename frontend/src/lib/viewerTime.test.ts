import { afterEach, describe, expect, it } from 'vitest';
import {
  formatViewerDay,
  formatViewerTime,
  setViewerTimeZoneForTests,
  viewerDayKey,
} from './viewerTime';

// Job #13 was created at 04:30:30Z on Sep 28 — 11:30 PM on Sep 27 in Chicago.
const LATE_EVENING_CT = '2026-09-28T04:30:30.856Z';

describe('viewer-time formatter', () => {
  afterEach(() => setViewerTimeZoneForTests(null));

  it('keeps day and clock on the same instant for late evening CT (already tomorrow in UTC)', () => {
    setViewerTimeZoneForTests('America/Chicago');
    expect(formatViewerTime(LATE_EVENING_CT)).toBe('11:30 PM CT');
    expect(viewerDayKey(LATE_EVENING_CT)).toBe('2026-09-27');
    expect(formatViewerDay(LATE_EVENING_CT)).toBe('Sunday, September 27, 2026');
    // Never the UTC calendar day paired with the local clock.
    expect(viewerDayKey(LATE_EVENING_CT)).not.toBe(LATE_EVENING_CT.slice(0, 10));
  });

  it('flips to the next day exactly at local midnight, not UTC midnight', () => {
    setViewerTimeZoneForTests('America/Chicago');
    expect(viewerDayKey('2026-09-28T04:59:59Z')).toBe('2026-09-27');
    expect(formatViewerTime('2026-09-28T04:59:59Z')).toBe('11:59 PM CT');
    expect(viewerDayKey('2026-09-28T05:00:00Z')).toBe('2026-09-28');
    expect(formatViewerTime('2026-09-28T05:00:00Z')).toBe('12:00 AM CT');
    // UTC midnight is still the evening before in Chicago.
    expect(viewerDayKey('2026-09-28T00:00:00Z')).toBe('2026-09-27');
    expect(formatViewerTime('2026-09-28T00:00:00Z')).toBe('7:00 PM CT');
  });

  it('prints the same instant in whatever zone the viewer is in', () => {
    setViewerTimeZoneForTests('UTC');
    expect(formatViewerTime(LATE_EVENING_CT)).toBe('4:30 AM UTC');
    expect(viewerDayKey(LATE_EVENING_CT)).toBe('2026-09-28');
    setViewerTimeZoneForTests('America/Los_Angeles');
    expect(formatViewerTime(LATE_EVENING_CT)).toBe('9:30 PM PT');
    expect(viewerDayKey(LATE_EVENING_CT)).toBe('2026-09-27');
  });

  it('returns empty strings for missing or bad input', () => {
    expect(formatViewerTime(null)).toBe('');
    expect(formatViewerDay('')).toBe('');
    expect(viewerDayKey('not a date')).toBe('');
  });
});
