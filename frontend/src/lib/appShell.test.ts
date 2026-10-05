import { afterEach, describe, expect, it, vi } from 'vitest';
import { initAppShell, isAppShellUserAgent } from './appShell';

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
