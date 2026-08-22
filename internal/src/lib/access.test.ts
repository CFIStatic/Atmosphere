import { describe, expect, it } from 'vitest';
import { canSeeAccounts, landingPath } from './access';

describe('access', () => {
  it('limits named accounts to internal staff', () => {
    expect(canSeeAccounts('internal')).toBe(true);
    expect(canSeeAccounts('investor')).toBe(false);
    expect(canSeeAccounts(null)).toBe(false);
  });

  it('sends signed-in staff to overview', () => {
    expect(landingPath('internal')).toBe('/overview');
    expect(landingPath(null)).toBe('/login');
  });
});
