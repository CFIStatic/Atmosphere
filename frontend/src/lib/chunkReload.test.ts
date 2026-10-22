import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError } from './chunkReload';

describe('chunkReload', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('recognizes stale-chunk errors across browsers', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/LoginsPage-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('reloads once, then refuses within the guard window', () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    expect(reloadOnceForChunkError(1_000_000)).toBe(true);
    expect(reloadOnceForChunkError(1_005_000)).toBe(false);
    expect(reloadOnceForChunkError(1_100_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
