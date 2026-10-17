import { describe, expect, it } from 'vitest';
import { posterClock, SAMPLE_EVIDENCE } from './firstEvidence';

describe('sample evidence', () => {
  it('the sample never names a speaker role', () => {
    expect(SAMPLE_EVIDENCE.ask.answer).toMatch(/Speaker not identified/);
    expect(JSON.stringify(SAMPLE_EVIDENCE)).not.toMatch(/homeowner/i);
  });

  it('an unknown first-clip length shows a dash on the poster, not 0:00', () => {
    expect(posterClock(null)).toBe('—');
    expect(posterClock(0)).toBe('—');
    expect(posterClock(44.24)).toBe('0:44');
  });
});
