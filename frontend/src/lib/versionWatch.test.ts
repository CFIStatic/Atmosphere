import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveBuildId, hardNavigate, isNewerBuild } from './versionWatch';

describe('versionWatch', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('only flags a different, real build id', () => {
    expect(isNewerBuild('a', 'b')).toBe(true);
    expect(isNewerBuild('a', 'a')).toBe(false);
    expect(isNewerBuild('a', null)).toBe(false);
    expect(isNewerBuild('dev', 'b')).toBe(false);
  });

  it('reads buildId from /version.json and tolerates failures', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ buildId: 'x1' }), { status: 200 }));
    expect(await fetchLiveBuildId(ok as unknown as typeof fetch)).toBe('x1');
    const bad = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await fetchLiveBuildId(bad as unknown as typeof fetch)).toBeNull();
  });

  it('hard-navigates once, then refuses within the guard window', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
    expect(hardNavigate('/logins', 1_000_000)).toBe(true);
    expect(hardNavigate('/logins', 1_010_000)).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
