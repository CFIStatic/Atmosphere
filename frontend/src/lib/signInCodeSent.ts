/**
 * Remembers, for the code's lifetime, that a sign-in code was just emailed, so
 * the code box is still there after a reload or a trip to the mail app on a
 * phone. The email carries only the code, so losing the box would strand them.
 */
const TTL_MS = 60 * 60 * 1000;
const PREFIX = 'atm-signin-code-sent:';

export function markSignInCodeSent(key: string, value = '1'): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* storage unavailable: the box just won't survive a reload */
  }
}

/** The stored value when a code was sent under this key within the last hour. */
export function signInCodeSent(key: string): string | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: string };
    return Date.now() - at < TTL_MS ? value : null;
  } catch {
    return null;
  }
}

export function clearSignInCodeSent(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
