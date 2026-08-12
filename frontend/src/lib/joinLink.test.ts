import { describe, expect, it } from 'vitest';
import { joinSignupPath, joinSignupUrl, normalizeJoinCode } from './joinLink';

describe('normalizeJoinCode', () => {
  it('canonicalizes a code the way people type it off a phone', () => {
    expect(normalizeJoinCode('  8f3a9c2b ')).toBe('8F3A9C2B');
    expect(normalizeJoinCode('8F3A9C2B')).toBe('8F3A9C2B');
  });

  it('rejects anything that could never be a join code', () => {
    expect(normalizeJoinCode('short')).toBeNull();
    expect(normalizeJoinCode('THIRTEENCHARS')).toBeNull();
    expect(normalizeJoinCode('8F3A-9C2B')).toBeNull();
    expect(normalizeJoinCode('')).toBeNull();
    expect(normalizeJoinCode(null)).toBeNull();
    expect(normalizeJoinCode(undefined)).toBeNull();
  });
});

describe('join links', () => {
  it('opens signup in join mode with the code carried along', () => {
    expect(joinSignupPath('8F3A9C2B')).toBe('/signup?join=8F3A9C2B');
  });

  it('builds the absolute URL the QR code encodes', () => {
    expect(joinSignupUrl('https://app.example.com', '8F3A9C2B')).toBe(
      'https://app.example.com/signup?join=8F3A9C2B',
    );
    // A trailing slash on origin must not double up in the QR.
    expect(joinSignupUrl('https://app.example.com/', '8F3A9C2B')).toBe(
      'https://app.example.com/signup?join=8F3A9C2B',
    );
  });
});
