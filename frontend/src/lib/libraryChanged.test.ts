import { describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_CHANGED_EVENT,
  notifyLibraryChanged,
  subscribeLibraryChanged,
} from './libraryChanged';

describe('libraryChanged', () => {
  it('notifies subscribers when the library inventory changes', () => {
    const onChange = vi.fn();
    const stop = subscribeLibraryChanged(onChange);
    window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
    expect(onChange).toHaveBeenCalledTimes(1);
    notifyLibraryChanged();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    notifyLibraryChanged();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
