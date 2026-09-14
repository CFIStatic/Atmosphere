import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SCROLL_FOLLOW_NEAR_PX,
  isNearBottom,
  resumeScrollFollow,
  scrollFollowAfterUserScroll,
  shouldAutoScrollActiveRow,
  type ScrollFollowState,
} from '../lib/scrollFollow';

/**
 * Stick-to-bottom follow for a scrollable list synced to a playhead.
 * Auto-scrolls the active row only while `following` is true.
 */
export function useScrollFollow(opts?: { thresholdPx?: number; enabled?: boolean }) {
  const thresholdPx = opts?.thresholdPx ?? SCROLL_FOLLOW_NEAR_PX;
  const enabled = opts?.enabled !== false;
  const scrollerRef = useRef<HTMLElement | null>(null);
  const programmaticRef = useRef(false);
  const [state, setState] = useState<ScrollFollowState>(() => resumeScrollFollow());

  const onScroll = useCallback(() => {
    if (!enabled || programmaticRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    setState((prev) =>
      scrollFollowAfterUserScroll(
        prev,
        {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        },
        thresholdPx,
      ),
    );
  }, [enabled, thresholdPx]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !enabled) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [enabled, onScroll]);

  const followActive = useCallback(
    (row: HTMLElement | null | undefined) => {
      if (!enabled || !row || !shouldAutoScrollActiveRow(state)) return;
      const scroller = scrollerRef.current;
      programmaticRef.current = true;
      if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      window.setTimeout(() => {
        programmaticRef.current = false;
        // Re-check after programmatic scroll so we stay "following" when
        // we intentionally moved to the active row near the bottom.
        if (scroller && isNearBottom({
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
        }, thresholdPx)) {
          setState(resumeScrollFollow());
        }
      }, 160);
    },
    [enabled, state, thresholdPx],
  );

  const resume = useCallback(() => setState(resumeScrollFollow()), []);

  return {
    scrollerRef,
    following: state.following,
    followActive,
    resume,
    setScroller: (el: HTMLElement | null) => {
      scrollerRef.current = el;
    },
  };
}
