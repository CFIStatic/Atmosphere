import { describe, expect, it } from 'vitest';
import { APP_NAME, documentTitleFor } from './documentTitle';

describe('documentTitleFor', () => {
  it('names the product on unknown routes', () => {
    expect(documentTitleFor('/')).toBe(APP_NAME);
    expect(documentTitleFor('/not-a-page')).toBe('Atmosphere');
  });

  it('keeps Atmosphere in every known tab title', () => {
    expect(documentTitleFor('/login')).toBe('Sign in · Atmosphere');
    expect(documentTitleFor('/verifier-library')).toBe('Overview · Atmosphere');
    expect(documentTitleFor('/intake')).toBe('Start a job · Atmosphere');
    expect(documentTitleFor('/field')).toBe('Field · Atmosphere');
    expect(documentTitleFor('/jobs/abc')).toBe('My jobs · Atmosphere');
    expect(documentTitleFor('/settings')).toBe('Settings · Atmosphere');
  });

  it('distinguishes create vs join signup', () => {
    expect(documentTitleFor('/signup')).toBe('Create your organization · Atmosphere');
    expect(documentTitleFor('/signup', '?intent=join')).toBe(
      'Link to the office account · Atmosphere',
    );
  });
});
