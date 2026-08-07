import { describe, expect, it } from 'vitest';
import { postAuthDestination } from './postAuth';

describe('postAuthDestination', () => {
  it('returns the fallback when the user has an org', () => {
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/usage')).toBe('/usage');
  });

  it('preserves the intended destination through onboarding', () => {
    expect(postAuthDestination(null, '/usage')).toBe('/onboarding?next=%2Fusage');
  });
});
