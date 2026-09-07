import { describe, expect, it } from 'vitest';
import {
  CURRENT_TERMS_VERSION,
  TERMS_PUBLIC_URL,
  publicTermsStatus,
  termsRequired,
} from './terms';

describe('terms version helpers', () => {
  it('matches the September 7 2026 public Terms of Use', () => {
    expect(CURRENT_TERMS_VERSION).toBe('2026-09-07');
    expect(TERMS_PUBLIC_URL).toBe('https://atmosphereteam.com/terms');
  });

  it('requires acknowledgment when status is missing or stale', () => {
    expect(termsRequired(null)).toBe(true);
    expect(
      termsRequired({
        required: true,
        currentVersion: CURRENT_TERMS_VERSION,
        acceptedVersion: '2025-01-01',
        url: TERMS_PUBLIC_URL,
      }),
    ).toBe(true);
  });

  it('clears the gate when the accepted version is current', () => {
    expect(
      termsRequired({
        required: false,
        currentVersion: CURRENT_TERMS_VERSION,
        acceptedVersion: CURRENT_TERMS_VERSION,
        url: TERMS_PUBLIC_URL,
      }),
    ).toBe(false);
  });

  it('starts unsigned visitors as required', () => {
    expect(publicTermsStatus().required).toBe(true);
    expect(publicTermsStatus().currentVersion).toBe(CURRENT_TERMS_VERSION);
  });
});
