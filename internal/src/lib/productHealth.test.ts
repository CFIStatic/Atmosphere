import { describe, expect, it } from 'vitest';
import { normalizeProductHealth } from './productHealth';
import { emptyTrackingPayload, testHealth } from '../test/fixtures';

describe('normalizeProductHealth', () => {
  it('turns periods with no rows into zero counts and no rates', () => {
    const h = normalizeProductHealth(emptyTrackingPayload());
    expect(h.uploads.current).toMatchObject({ started: 0, completed: 0, completionRatePct: null });
    expect(h.uploads.prior.started).toBe(0);
    expect(h.ask.current).toMatchObject({ turns: 0, errorRatePct: null, medianMs: null });
    expect(h.analysis.prior.medianSeconds).toBeNull();
    // Periods that do have rows pass through untouched.
    expect(h.analysis.current).toEqual(testHealth.analysis.current);
    expect(h.northStar).toEqual(testHealth.northStar);
  });

  it('never throws on an empty or malformed payload', () => {
    for (const raw of [null, undefined, {}, [], 'x']) {
      const h = normalizeProductHealth(raw);
      expect(h.northStar.weekly).toEqual([]);
      expect(h.uploads.current.started).toBe(0);
      expect(h.evidence.current.proofsAnalysed).toBe(0);
    }
  });
});
