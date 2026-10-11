/**
 * The sign-in lives in one cookie shared by every tab. Signing in as someone
 * else in one tab silently changes who the other tabs act as, while their
 * header still shows the old name and workspace. Each tab re-checks who is
 * signed in when another tab signs in or out, and when it comes back into
 * view, and reloads when the account changed.
 */

const CHANNEL = 'atm-auth';
const MIN_CHECK_GAP_MS = 2000;

/** Tell the other open tabs the signed-in account just changed. */
export function announceAccountChange(): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: 'account-changed' });
    channel.close();
  } catch {
    /* other tabs still catch up when they regain focus */
  }
}

export interface AccountSwitchWatch {
  /** The account this tab is showing (null when signed out). */
  currentUserId: () => string | null;
  /** Who the shared cookie is signed in as now; null = signed out, undefined = could not tell. */
  fetchUserId: () => Promise<string | null | undefined>;
  onSwitch: () => void;
}

/** Start watching; returns a stop function. */
export function watchAccountSwitch(watch: AccountSwitchWatch): () => void {
  let lastCheck = 0;
  let running = false;
  let stopped = false;

  const check = async (force = false) => {
    if (stopped || running) return;
    const now = Date.now();
    if (!force && now - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now;
    running = true;
    try {
      const shown = watch.currentUserId();
      const actual = await watch.fetchUserId();
      if (stopped || actual === undefined) return;
      if (actual !== shown) watch.onSwitch();
    } finally {
      running = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  const onFocus = () => void check();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => void check(true);
    }
  } catch {
    channel = null;
  }

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
    channel?.close();
  };
}
