/**
 * Sticky auto-follow for playhead-synced lists (evidence log / transcript).
 *
 * Follow while the user is near the bottom (or hasn't scrolled away).
 * Once they scroll up, pause follow until they return near the bottom
 * or explicitly resume.
 *
 * Never use Element.scrollIntoView for playhead follow — that scrolls
 * ancestor containers (detail sheet / page) and can shove the video
 * off-screen, which some browsers treat as a reason to auto-pause.
 */

export const SCROLL_FOLLOW_NEAR_PX = 96;

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export function distanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function isNearBottom(
  metrics: ScrollMetrics,
  thresholdPx: number = SCROLL_FOLLOW_NEAR_PX,
): boolean {
  // Empty / non-scrollable containers are always "at bottom".
  if (metrics.scrollHeight <= metrics.clientHeight + 1) return true;
  return distanceFromBottom(metrics) <= thresholdPx;
}

export type ScrollFollowState = {
  /** When true, playhead updates may scroll the active row into view. */
  following: boolean;
};

export function scrollFollowAfterUserScroll(
  state: ScrollFollowState,
  metrics: ScrollMetrics,
  thresholdPx: number = SCROLL_FOLLOW_NEAR_PX,
): ScrollFollowState {
  const near = isNearBottom(metrics, thresholdPx);
  if (near === state.following) return state;
  return { following: near };
}

export function shouldAutoScrollActiveRow(state: ScrollFollowState): boolean {
  return state.following;
}

export function resumeScrollFollow(): ScrollFollowState {
  return { following: true };
}

export function pauseScrollFollow(): ScrollFollowState {
  return { following: false };
}

/**
 * Scroll `row` into visibility inside `scroller` only — adjust scrollTop.
 * Does not call scrollIntoView (ancestor-safe; avoids player auto-pause).
 */
export function scrollRowIntoScroller(scroller: HTMLElement, row: HTMLElement): void {
  const sideRect = scroller.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const topGap = rowRect.top - sideRect.top;
  const bottomGap = rowRect.bottom - sideRect.bottom;
  if (topGap < 0) {
    scroller.scrollTop += topGap;
  } else if (bottomGap > 0) {
    scroller.scrollTop += bottomGap;
  }
}
