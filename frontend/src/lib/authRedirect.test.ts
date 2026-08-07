import { describe, expect, it } from 'vitest';
import { loginHref, resolveAuthRedirect, safeAuthRedirect } from './authRedirect';

describe('safeAuthRedirect', () => {
  it('accepts relative in-app paths', () => {
    expect(safeAuthRedirect('/usage')).toBe('/usage');
    expect(safeAuthRedirect('/billing?tab=plan')).toBe('/billing?tab=plan');
  });

  it('rejects open redirects', () => {
    expect(safeAuthRedirect('https://evil.test')).toBeNull();
    expect(safeAuthRedirect('//evil.test')).toBeNull();
    expect(safeAuthRedirect('../admin')).toBeNull();
  });
});

describe('resolveAuthRedirect', () => {
  it('prefers ?next= over router state', () => {
    expect(resolveAuthRedirect('/usage', '/billing', '/dashboard')).toBe('/usage');
  });

  it('falls back to platform home', () => {
    expect(resolveAuthRedirect(null, null, '/verifier-library')).toBe('/verifier-library');
  });
});

describe('loginHref', () => {
  it('encodes the return path', () => {
    expect(loginHref('/usage')).toBe('/login?next=%2Fusage');
  });
});
