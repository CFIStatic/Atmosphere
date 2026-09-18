import { describe, expect, it } from 'vitest';
import {
  compactDayLabel,
  emptyTokenTotals,
  formatAnalysisMinutes,
  peakDayTokens,
  sharePct,
  tokenSpendCaption,
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

describe('tokenSpendCaption', () => {
  it('names the period, the UTC window, the USD unit, and whose spend', () => {
    expect(tokenSpendCaption({
      range: 'period',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
    })).toBe('This billing period, Aug 1, 2026 to Sep 1, 2026 UTC · USD · this organization');
    expect(tokenSpendCaption({
      range: '30d',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
      orgName: 'Ortiz Restoration',
    })).toBe('Last 30 days, Aug 1, 2026 to Aug 31, 2026 UTC · USD · Ortiz Restoration');
  });
});
