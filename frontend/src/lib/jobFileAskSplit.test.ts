import { afterEach, describe, expect, it } from 'vitest';
import {
  clampAskWidth,
  clearAskSplitWidth,
  DEFAULT_ASK_WIDTH_PX,
  JOB_FILE_ASK_SPLIT_KEY,
  MIN_ASK_WIDTH_PX,
  MIN_FILE_WIDTH_PX,
  readAskSplitWidth,
  writeAskSplitWidth,
} from './jobFileAskSplit';

afterEach(() => {
  window.localStorage.removeItem(JOB_FILE_ASK_SPLIT_KEY);
});

describe('clampAskWidth', () => {
  it('enforces the Ask minimum', () => {
    expect(clampAskWidth(100)).toBe(MIN_ASK_WIDTH_PX);
  });

  it('leaves room for the job-file pane when a container width is known', () => {
    expect(clampAskWidth(900, 800)).toBe(800 - MIN_FILE_WIDTH_PX);
  });

  it('rounds to an integer pixel width', () => {
    expect(clampAskWidth(400.7)).toBe(401);
  });
});

describe('ask split localStorage', () => {
  it('defaults when nothing is stored', () => {
    expect(readAskSplitWidth()).toBe(DEFAULT_ASK_WIDTH_PX);
  });

  it('persists and reloads a preferred width', () => {
    expect(writeAskSplitWidth(420)).toBe(420);
    expect(window.localStorage.getItem(JOB_FILE_ASK_SPLIT_KEY)).toBe('420');
    expect(readAskSplitWidth()).toBe(420);
  });

  it('clears back to the default', () => {
    writeAskSplitWidth(440);
    clearAskSplitWidth();
    expect(window.localStorage.getItem(JOB_FILE_ASK_SPLIT_KEY)).toBeNull();
    expect(readAskSplitWidth()).toBe(DEFAULT_ASK_WIDTH_PX);
  });

  it('ignores non-numeric storage', () => {
    window.localStorage.setItem(JOB_FILE_ASK_SPLIT_KEY, 'nope');
    expect(readAskSplitWidth()).toBe(DEFAULT_ASK_WIDTH_PX);
  });
});
