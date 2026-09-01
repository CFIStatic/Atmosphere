import { useEffect, useRef } from 'react';

/**
 * Call `tick` on an interval while the document is visible.
 *
 * Used by the open job file so newly filed videos appear without a manual
 * refresh. Pauses when the tab is hidden so background office tabs do not
 * hammer the API.
 */
export function useVisiblePolling(
  tick: () => void,
  {
    enabled,
    intervalMs = 12_000,
  }: {
    enabled: boolean;
    intervalMs?: number;
  },
): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;

    let id: ReturnType<typeof setInterval> | null = null;

    const clear = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };

    const start = () => {
      clear();
      id = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        tickRef.current();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clear();
        return;
      }
      tickRef.current();
      start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}
