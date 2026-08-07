import { describe, expect, it } from 'vitest';
import { postAuthDestination } from './postAuth';

describe('postAuthDestination', () => {
  it('returns the fallback when the user has an org', () => {
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/usage')).toBe('/usage');
  });

  it('preserves the intended destination through signup setup', () => {
    expect(postAuthDestination(null, '/usage')).toBe('/signup?step=2&next=%2Fusage');
  });
});
