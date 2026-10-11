import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchAccountSwitch } from './accountSwitch';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('watchAccountSwitch', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('reloads when the tab comes back signed in as someone else', async () => {
    const onSwitch = vi.fn();
    stop = watchAccountSwitch({
      currentUserId: () => 'homeowner',
      fetchUserId: async () => 'sub',
      onSwitch,
    });
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('stays put when the account is the same or cannot be read', async () => {
    const onSwitch = vi.fn();
    let answer: string | null | undefined = 'homeowner';
    stop = watchAccountSwitch({
      currentUserId: () => 'homeowner',
      fetchUserId: async () => answer,
      onSwitch,
    });
    window.dispatchEvent(new Event('focus'));
    await flush();
    answer = undefined;
    await new Promise((r) => setTimeout(r, 2100));
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('reloads a signed-in tab after another tab signs out', async () => {
    const onSwitch = vi.fn();
    stop = watchAccountSwitch({
      currentUserId: () => 'contractor',
      fetchUserId: async () => null,
      onSwitch,
    });
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});
