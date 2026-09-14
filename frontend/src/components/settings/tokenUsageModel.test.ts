import { describe, expect, it } from 'vitest';
import {
  compactDayLabel,
  emptyTokenTotals,
  formatAnalysisMinutes,
  peakDayTokens,
  sharePct,
} from './tokenUsageModel';

describe('tokenUsageModel', () => {
  it('clamps share percentages', () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(0, 0)).toBe(0);
    expect(sharePct(200, 100)).toBe(100);
  });

  it('labels UTC days without shifting the calendar', () => {
    expect(compactDayLabel('2026-08-01')).toMatch(/Aug/);
    expect(compactDayLabel('2026-08-01')).toMatch(/1/);
  });

  it('never reports a zero peak so the chart has a scale', () => {
    expect(peakDayTokens([{ day: '2026-08-01', ...emptyTokenTotals(), byFeature: {
      video_analysis: emptyTokenTotals(),
      chat: emptyTokenTotals(),
      ask: emptyTokenTotals(),
      other: emptyTokenTotals(),
    } }])).toBe(1);
  });
});

describe('formatAnalysisMinutes', () => {
  it('formats known minutes and unknown as em dash', () => {
    expect(formatAnalysisMinutes(12.5)).toBe('12.5');
    expect(formatAnalysisMinutes(12)).toBe('12');
    expect(formatAnalysisMinutes(null)).toBe('—');
    expect(formatAnalysisMinutes(undefined)).toBe('—');
  });
});
