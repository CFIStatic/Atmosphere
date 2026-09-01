import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisiblePolling } from './useVisiblePolling';

describe('useVisiblePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks on the interval while enabled and visible', () => {
    const tick = vi.fn();
    renderHook(() => useVisiblePolling(tick, { enabled: true, intervalMs: 1000 }));
    expect(tick).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('does not tick when disabled', () => {
    const tick = vi.fn();
    renderHook(() => useVisiblePolling(tick, { enabled: false, intervalMs: 1000 }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(tick).not.toHaveBeenCalled();
  });
});
