import { describe, expect, it } from 'vitest';
import { homeownerShareText } from './ProofOfWork';

describe('homeownerShareText (office label on delayed clips)', () => {
  const now = Date.parse('2026-10-22T15:00:00Z');
  it('counts down the hours until the homeowner sees a clip', () => {
    expect(homeownerShareText({ homeownerVisibleAt: '2026-10-23T13:30:00Z' }, now)).toBe('Visible to homeowner in 23h');
  });
  it('says held, and nothing once visible or with no delay', () => {
    expect(homeownerShareText({ homeownerVisibleAt: null }, now)).toBe('Held from homeowner');
    expect(homeownerShareText({ homeownerVisibleAt: '2026-10-22T14:00:00Z' }, now)).toBeNull();
    expect(homeownerShareText({}, now)).toBeNull();
  });
});
