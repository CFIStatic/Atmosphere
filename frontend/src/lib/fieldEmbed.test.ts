import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptDestinationFrom,
  clearFieldEmbedSession,
  fieldEmbedAccessToken,
  fieldSessionTokens,
  hasFieldEmbedInPath,
  isFieldCaptureHost,
  isFieldCaptureOrigin,
  isFieldEmbedQuery,
  isPhoneShellViewport,
  listenForFieldSession,
  markFieldEmbed,
  PHONE_SHELL_MAX_PX,
  rememberFieldEmbedSession,
  waitForParentFieldSession,
  withFieldEmbed,
} from './fieldEmbed';

describe('field embed helpers', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fieldEmbed;
    clearFieldEmbedSession();
    vi.restoreAllMocks();
  });

  it('recognises standalone Field Capture hosts and local phones', () => {
    expect(isFieldCaptureHost('field-capture-production.up.railway.app')).toBe(true);
    expect(isFieldCaptureHost('field-capture.up.railway.app')).toBe(true);
    expect(isFieldCaptureHost('field-capture-staging.up.railway.app')).toBe(true);
    expect(isFieldCaptureHost('localhost')).toBe(true);
    expect(isFieldCaptureHost('atmosphere-web-production.up.railway.app')).toBe(false);
    expect(isFieldCaptureOrigin('https://field-capture-production.up.railway.app')).toBe(true);
    expect(isFieldCaptureOrigin('https://evil.example')).toBe(false);
  });

  it('stamps embed=field without dropping an existing query', () => {
    expect(withFieldEmbed('/verifier-library')).toBe('/verifier-library?embed=field');
    expect(withFieldEmbed('/field?x=1')).toBe('/field?x=1&embed=field');
    expect(withFieldEmbed('/jobs?embed=field')).toBe('/jobs?embed=field');
  });

  it('reads the Field Capture embed flag from the query', () => {
    expect(isFieldEmbedQuery('?embed=field')).toBe(true);
    expect(isFieldEmbedQuery('embed=1')).toBe(false);
    expect(markFieldEmbed('?embed=field')).toBe(true);
    expect(document.documentElement.dataset.fieldEmbed).toBe('1');
  });

  it('treats a 480px Field Capture frame as a phone shell', () => {
    expect(isPhoneShellViewport(390)).toBe(true);
    expect(isPhoneShellViewport(480)).toBe(true);
    expect(isPhoneShellViewport(PHONE_SHELL_MAX_PX)).toBe(true);
    expect(isPhoneShellViewport(1024)).toBe(false);
  });

  it('detects embed=field on a return path', () => {
    expect(hasFieldEmbedInPath('/verifier-library?embed=field')).toBe(true);
    expect(hasFieldEmbedInPath('/verifier-library')).toBe(false);
  });

  it('sends login and signup landings to the phone Platform', () => {
    expect(adoptDestinationFrom('/login', '?next=%2Fverifier-library%3Fembed%3Dfield')).toBe(
      '/verifier-library?embed=field',
    );
    expect(adoptDestinationFrom('/login', '')).toBe('/verifier-library?embed=field');
    expect(adoptDestinationFrom('/signup', '?step=2&next=%2Fverifier-library')).toBe(
      '/verifier-library?embed=field',
    );
    expect(adoptDestinationFrom('/jobs', '?tab=open')).toBe('/jobs?tab=open&embed=field');
  });

  it('accepts Field Capture session tokens and ignores empties', () => {
    expect(
      fieldSessionTokens({ refreshToken: 'refresh-token-1', accessToken: 'access-token-1' }),
    ).toEqual({
      refreshToken: 'refresh-token-1',
      accessToken: 'access-token-1',
    });
    expect(fieldSessionTokens({ refreshToken: null, accessToken: '' })).toEqual({
      refreshToken: null,
      accessToken: null,
    });
  });

  it('remembers the adopted Field Capture session for Bearer API calls', () => {
    rememberFieldEmbedSession('access-from-phone', 'refresh-from-phone');
    expect(fieldEmbedAccessToken()).toBe('access-from-phone');
  });

  it('adopts a parent Field Capture session without a second password', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/refresh')) {
        return new Response(
          JSON.stringify({
            user: { id: 'u1' },
            session: { accessToken: 'office-access', refreshToken: 'office-refresh' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('', { status: 404 });
    });

    const stop = listenForFieldSession();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://field-capture-production.up.railway.app',
        data: {
          atmosphere: 'field-session',
          refreshToken: 'phone-refresh-token',
          accessToken: 'phone-access-token',
        },
      }),
    );

    await vi.waitFor(() => {
      expect(fieldEmbedAccessToken()).toBe('office-access');
    });
    await expect(waitForParentFieldSession(50)).resolves.toBe(true);
    stop();
  });

  it('does not treat a leftover embed token as a live session', async () => {
    rememberFieldEmbedSession('expired-access-token', 'expired-refresh-token');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 401 }));

    await expect(waitForParentFieldSession(50)).resolves.toBe(false);
    expect(fieldEmbedAccessToken()).toBeNull();
  });
});
