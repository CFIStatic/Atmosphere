import { describe, expect, it } from 'vitest';
import {
  distanceFromBottom,
  isNearBottom,
  pauseScrollFollow,
  resumeScrollFollow,
  scrollFollowAfterUserScroll,
  scrollRowIntoScroller,
  shouldAutoScrollActiveRow,
} from './scrollFollow';

describe('scrollFollow', () => {
  it('treats a short non-scrollable list as near the bottom', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toBe(true);
  });

  it('is near bottom only within the threshold', () => {
    const metrics = { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 };
    expect(distanceFromBottom(metrics)).toBe(100);
    expect(isNearBottom(metrics, 96)).toBe(false);
    expect(isNearBottom(metrics, 120)).toBe(true);
  });

  it('pauses follow when the user scrolls away, resumes near bottom', () => {
    let state = resumeScrollFollow();
    expect(shouldAutoScrollActiveRow(state)).toBe(true);

    state = scrollFollowAfterUserScroll(state, {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    expect(state.following).toBe(false);
    expect(shouldAutoScrollActiveRow(state)).toBe(false);

    state = scrollFollowAfterUserScroll(state, {
      scrollTop: 1450,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    expect(state.following).toBe(true);
  });

  it('can pause and resume explicitly', () => {
    expect(pauseScrollFollow().following).toBe(false);
    expect(resumeScrollFollow().following).toBe(true);
  });

  it('scrolls only the scroller via scrollTop, never scrollIntoView', () => {
    const scroller = {
      scrollTop: 100,
      getBoundingClientRect: () => ({ top: 0, bottom: 200, left: 0, right: 100 }),
    } as unknown as HTMLElement;
    const row = {
      getBoundingClientRect: () => ({ top: 250, bottom: 280, left: 0, right: 100 }),
    } as unknown as HTMLElement;
    scrollRowIntoScroller(scroller, row);
    expect(scroller.scrollTop).toBe(180);
  });
});
