import { afterEach, describe, expect, it, vi } from 'vitest';
import { appShellSafeBillingText, initAppShell, isAppShellUserAgent, isInAppShell } from './appShell';

describe('app shell detection', () => {
  afterEach(() => {
    delete document.documentElement.dataset.appShell;
    vi.restoreAllMocks();
  });

  it('only matches the Field Capture app user agent', () => {
    expect(isAppShellUserAgent('Mozilla/5.0 (iPhone) Mobile/15E148 AtmosphereFieldCapture')).toBe(true);
    expect(isAppShellUserAgent('Mozilla/5.0 (iPhone) Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isAppShellUserAgent('Mozilla/5.0 (Macintosh) Chrome/130')).toBe(false);
  });

  it('leaves a normal browser untouched', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) Safari/604.1');
    initAppShell();
    expect(document.documentElement.dataset.appShell).toBeUndefined();
  });

  it('marks the iPhone app', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 AtmosphereFieldCapture',
    );
    initAppShell();
    expect(document.documentElement.dataset.appShell).toBe('ios');
  });
});

describe('app shell billing text', () => {
  afterEach(() => {
    delete document.documentElement.dataset.appShell;
  });

  it('is in the app when the document is marked, never in a plain browser', () => {
    expect(isInAppShell()).toBe(false);
    document.documentElement.dataset.appShell = 'ios';
    expect(isInAppShell()).toBe(true);
  });

  it('drops upgrade, buy-credit, and priced seat sentences in the app only', () => {
    const limited =
      'AI is paused until the usage allowance resets on November 1, 2026. Uploaded videos are saved and will be analyzed when the allowance is available. Upgrade the plan or buy credits to continue.';
    expect(appShellSafeBillingText(limited, false)).toBe(limited);
    const inApp = appShellSafeBillingText(limited, true);
    expect(inApp).not.toMatch(/upgrade|buy/i);
    expect(inApp).toMatch(/AI is paused until/);
    expect(appShellSafeBillingText('An owner can upgrade the plan or buy credits.', true)).toBe(
      'Plans and billing are managed on atmosphereteam.com.',
    );
    const seat =
      'This plan includes 3 Field Capture accounts (3 in use). Add 1 extra Field Capture seat at $125/mo to continue.';
    expect(appShellSafeBillingText(seat, true)).toBe('This plan includes 3 Field Capture accounts (3 in use).');
    const daily =
      'This account is close to its daily usage limit. AI keeps working until the limit, then pauses unless you buy credits.';
    expect(appShellSafeBillingText(daily, true)).toBe(
      'This account is close to its daily usage limit. AI keeps working until the limit.',
    );
  });
});
