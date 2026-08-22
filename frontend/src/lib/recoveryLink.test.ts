import { describe, expect, it, beforeEach } from 'vitest';
import {
  consumeRecoveryRedirect,
  isRecoveryArrival,
  parseRecoveryLink,
  resetRecoveryLinkCapture,
  takeRecoveryLink,
} from './recoveryLink';

describe('recoveryLink', () => {
  beforeEach(() => {
    resetRecoveryLinkCapture();
  });

  it('recognises the stock implicit recovery hash that used to land on /', () => {
    const hash = '#access_token=jwt&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery';
    expect(isRecoveryArrival('', hash)).toBe(true);
    expect(parseRecoveryLink('', hash).credential).toEqual({
      accessToken: 'jwt',
      refreshToken: 'r1',
    });
  });

  it('recognises a token_hash query from Atmosphere-sent mail', () => {
    expect(isRecoveryArrival('?token_hash=abc&type=recovery', '')).toBe(true);
    expect(parseRecoveryLink('?token_hash=abc&type=recovery', '').credential).toEqual({
      tokenHash: 'abc',
    });
  });

  it('rewrites /#access_token=…&type=recovery to /reset-password', () => {
    const rewritten: string[] = [];
    const moved = consumeRecoveryRedirect(
      { pathname: '/', search: '', hash: '#access_token=jwt&refresh_token=r1&type=recovery' },
      (url) => rewritten.push(url),
    );
    expect(moved).toBe(true);
    expect(rewritten).toEqual(['/reset-password#access_token=jwt&refresh_token=r1&type=recovery']);
  });

  it('does not treat a normal dashboard visit as recovery', () => {
    expect(isRecoveryArrival('', '')).toBe(false);
    expect(
      consumeRecoveryRedirect({ pathname: '/', search: '', hash: '' }, () => {
        throw new Error('should not rewrite');
      }),
    ).toBe(false);
  });

  it('keeps the credential after the address bar is scrubbed (StrictMode remount)', () => {
    const first = takeRecoveryLink('?token_hash=abc&type=recovery', '');
    expect(first.credential).toEqual({ tokenHash: 'abc' });
    const second = takeRecoveryLink('', '');
    expect(second.credential).toEqual({ tokenHash: 'abc' });
  });
});
