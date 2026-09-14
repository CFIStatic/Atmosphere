/**
 * Sticky auto-follow for playhead-synced lists (evidence log / transcript).
 *
 * Follow while the user is near the bottom (or hasn't scrolled away).
 * Once they scroll up, pause follow until they return near the bottom
 * or explicitly resume.
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
