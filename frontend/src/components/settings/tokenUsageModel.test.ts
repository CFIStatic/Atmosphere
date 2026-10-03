import { describe, expect, it } from 'vitest';
import type { TokenUsageDay, TokenUsageRecent } from '../../lib/api';
import { formatDailyUsd } from '../../lib/money';
import {
  compactDayLabel,
  dailyActorLabel,
  dailyUsageRows,
  emptyTokenTotals,
  formatAnalysisMinutes,
  mergeAskIntoChat,
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
    expect(
      peakDayTokens([
        {
          day: '2026-08-01',
          ...emptyTokenTotals(),
          byFeature: {
            video_analysis: emptyTokenTotals(),
            chat: emptyTokenTotals(),
            ask: emptyTokenTotals(),
            other: emptyTokenTotals(),
          },
        },
      ]),
    ).toBe(1);
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

function day(partial: Partial<TokenUsageDay> & Pick<TokenUsageDay, 'day'>): TokenUsageDay {
  return {
    ...emptyTokenTotals(),
    byFeature: {
      video_analysis: emptyTokenTotals(),
      chat: emptyTokenTotals(),
      ask: emptyTokenTotals(),
      other: emptyTokenTotals(),
    },
    ...partial,
  };
}

describe('formatDailyUsd', () => {
  it('keeps real fractional cost visible and matches ordinary spend above a cent', () => {
    expect(formatDailyUsd(0)).toBe('$0.00');
    expect(formatDailyUsd(4_000_000)).toBe('<$0.01');
    expect(formatDailyUsd(9_999_999)).toBe('<$0.01');
    expect(formatDailyUsd(10_000_000)).toBe('$0.01');
    expect(formatDailyUsd(80_000_000)).toBe('$0.08');
    expect(formatDailyUsd(81_200_000)).toBe('$0.0812');
    expect(formatDailyUsd(12_490_000)).toBe('$0.01249');
    expect(formatDailyUsd(18_400_000_000)).toBe('$18.40');
  });
});

describe('dailyUsageRows', () => {
  it('collapses a day to one row, newest first, using summed nanos', () => {
    const rows = dailyUsageRows([
      day({ day: '2026-09-29' }),
      day({
        day: '2026-09-30',
        events: 4,
        totalTokens: 6_300,
        priceNanos: 4_000_000,
        byFeature: {
          video_analysis: emptyTokenTotals(),
          chat: emptyTokenTotals(),
          ask: { ...emptyTokenTotals(), events: 4, totalTokens: 6_300, priceNanos: 4_000_000 },
          other: emptyTokenTotals(),
        },
        actors: [{ userId: 'u-1', name: 'El Presidente', events: 4 }],
      }),
      day({
        day: '2026-10-01',
        events: 13,
        totalTokens: 19_300,
        priceNanos: 80_000_000,
        byFeature: {
          video_analysis: emptyTokenTotals(),
          chat: emptyTokenTotals(),
          ask: { ...emptyTokenTotals(), events: 12, totalTokens: 19_300, priceNanos: 0 },
          other: { ...emptyTokenTotals(), events: 1, totalTokens: 0, priceNanos: 80_000_000 },
        },
        actors: [{ userId: 'u-1', name: 'El Presidente', events: 13 }],
      }),
    ]);

    expect(rows.map((row) => row.day)).toEqual(['2026-10-01', '2026-09-30']);
    expect(rows[0]).toMatchObject({
      calls: 13,
      totalTokens: 19_300,
      priceNanos: 80_000_000,
      surfaces: 'Chat, Other',
      breakdown: 'El Presidente · Chat, Other',
    });
    expect(rows[1]?.breakdown).toBe('El Presidente · Chat');
    expect(formatDailyUsd(rows[0]!.priceNanos)).toBe('$0.08');
    expect(formatDailyUsd(rows[1]!.priceNanos)).toBe('<$0.01');
  });

  it('uses recent calls for who only when they cover the whole day', () => {
    const recent: TokenUsageRecent[] = [
      {
        id: 'a',
        createdAt: '2026-08-02T16:00:00Z',
        feature: 'ask',
        source: 'proof_ask',
        modelId: null,
        userId: 'u-1',
        userName: 'Elena Ortiz',
        inputTokens: 1,
        outputTokens: 1,
        cacheTokens: 0,
        totalTokens: 2,
        priceNanos: 1,
      },
      {
        id: 'b',
        createdAt: '2026-08-02T15:00:00Z',
        feature: 'ask',
        source: 'proof_ask',
        modelId: null,
        userId: 'u-2',
        userName: 'Marcus Chen',
        inputTokens: 1,
        outputTokens: 1,
        cacheTokens: 0,
        totalTokens: 2,
        priceNanos: 1,
      },
    ];
    const covered = dailyUsageRows(
      [day({ day: '2026-08-02', events: 2, totalTokens: 4, priceNanos: 2 })],
      recent,
    );
    expect(covered[0]?.who).toBe('Elena Ortiz, Marcus Chen');

    const partial = dailyUsageRows(
      [day({ day: '2026-08-02', events: 40, totalTokens: 4, priceNanos: 2 })],
      recent,
    );
    expect(partial[0]?.who).toBe('—');
  });

  it('compacts a long actor list', () => {
    expect(
      dailyActorLabel([
        { userId: 'a', name: 'Ada', events: 4 },
        { userId: 'b', name: 'Bea', events: 3 },
        { userId: 'c', name: 'Cy', events: 2 },
        { userId: 'd', name: 'Dee', events: 1 },
      ]),
    ).toBe('Ada, Bea +2');
  });
});

describe('tokenSpendCaption', () => {
  it('names the period, the UTC window, the USD unit, and whose spend', () => {
    expect(
      tokenSpendCaption({
        range: 'period',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-09-01T00:00:00.000Z',
      }),
    ).toBe('This billing period, Aug 1, 2026 to Sep 1, 2026 UTC · USD · this organization');
    expect(
      tokenSpendCaption({
        range: '30d',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-31T00:00:00.000Z',
        orgName: 'Ortiz Restoration',
      }),
    ).toBe('Last 30 days, Aug 1, 2026 to Aug 31, 2026 UTC · USD · Ortiz Restoration');
  });
});

describe('mergeAskIntoChat', () => {
  const t = (events: number, totalTokens: number, priceNanos: number) => ({
    ...emptyTokenTotals(),
    events,
    totalTokens,
    priceNanos,
  });
  it('folds Ask into Chat everywhere and keeps the totals', () => {
    const report = {
      periodStart: '2026-09-23T20:22:00Z',
      periodEnd: '2026-10-23T20:22:00Z',
      range: 'period' as const,
      totals: t(19, 134_113, 5_917_763_000),
      byFeature: [
        { feature: 'ask' as const, ...t(17, 134_113, 5_837_763_000) },
        { feature: 'chat' as const, ...t(1, 0, 0) },
        { feature: 'web_search' as const, ...t(1, 0, 80_000_000) },
      ],
      byDay: [
        {
          day: '2026-10-01',
          ...t(3, 10_000, 300_000_000),
          byFeature: {
            video_analysis: emptyTokenTotals(),
            chat: t(1, 1_000, 20_000_000),
            ask: t(1, 9_000, 200_000_000),
            web_search: t(1, 0, 80_000_000),
            other: emptyTokenTotals(),
          },
        },
      ],
      byEmployee: [],
      byJob: [],
      recent: [
        {
          id: 'r',
          createdAt: '2026-10-01T19:51:03Z',
          feature: 'ask' as const,
          source: 'proof_ask',
          modelId: 'claude-sonnet-5',
          userId: null,
          userName: 'System',
          inputTokens: 1,
          outputTokens: 1,
          cacheTokens: 0,
          totalTokens: 2,
          priceNanos: 1,
        },
      ],
    };
    const merged = mergeAskIntoChat(report);
    expect(merged.totals).toEqual(report.totals);
    expect(merged.byFeature.map((row) => row.feature)).toEqual(['chat', 'web_search']);
    expect(merged.byFeature[0]).toMatchObject({ feature: 'chat', events: 18, totalTokens: 134_113, priceNanos: 5_837_763_000 });
    const sum = (rows: { priceNanos: number }[]) => rows.reduce((acc, row) => acc + row.priceNanos, 0);
    expect(sum(merged.byFeature)).toBe(sum(report.byFeature));
    expect(merged.byDay[0]?.byFeature.chat).toMatchObject({ events: 2, totalTokens: 10_000, priceNanos: 220_000_000 });
    expect(merged.byDay[0]?.byFeature.ask).toEqual(emptyTokenTotals());
    expect(merged.recent[0]?.feature).toBe('chat');
    expect(dailyUsageRows(merged.byDay)[0]?.surfaces).toBe('Chat, Web search');
  });
});
