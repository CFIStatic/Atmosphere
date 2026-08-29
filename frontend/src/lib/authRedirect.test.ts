import { describe, expect, it } from 'vitest';
import {
  loginHref,
  parseSignupIntent,
  resolveAuthRedirect,
  safeAuthRedirect,
  signupHref,
} from './authRedirect';

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

  it('returns bare login without a path', () => {
    expect(loginHref()).toBe('/login');
  });

  it('keeps the Field Capture embed on the login URL and the return path', () => {
    expect(loginHref('/verifier-library?embed=field')).toBe(
      '/login?embed=field&next=%2Fverifier-library%3Fembed%3Dfield',
    );
  });
});

describe('signupHref', () => {
  it('builds signup with email and next', () => {
    expect(signupHref({ email: 'a@b.co', next: '/usage' })).toBe(
      '/signup?next=%2Fusage&email=a%40b.co',
    );
  });

  it('adds intent=join when linking to an office account', () => {
    expect(signupHref({ intent: 'join', email: 'a@b.co' })).toBe(
      '/signup?email=a%40b.co&intent=join',
    );
  });
});

describe('parseSignupIntent', () => {
  it('treats join as linking to the office account', () => {
    expect(parseSignupIntent('join')).toBe('join');
  });

  it('defaults everything else to creating an organization', () => {
    expect(parseSignupIntent(null)).toBe('create');
    expect(parseSignupIntent('create')).toBe('create');
    expect(parseSignupIntent('other')).toBe('create');
  });
});
