import type { RecoveryCredential } from './api';

export interface ParsedRecoveryLink {
  credential: RecoveryCredential | null;
  linkError: string | null;
}

const RESET_PATH = '/reset-password';

let captured: ParsedRecoveryLink | null = null;

/** Test-only: drop the in-memory capture between cases. */
export function resetRecoveryLinkCapture(): void {
  captured = null;
}

/**
 * True when this arrival is a password-recovery redirect from Supabase.
 *
 * Stock templates land on Site URL (often `/`) with `#access_token=…&type=recovery`.
 * Custom templates use `?token_hash=` or PKCE `?code=` plus `type=recovery`.
 */
export function isRecoveryArrival(search: string, hash: string): boolean {
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  if (query.get('type') === 'recovery' || fragment.get('type') === 'recovery') return true;
  if (query.get('token_hash')) return true;
  if (fragment.get('access_token') && fragment.get('refresh_token')) return true;
  return false;
}

/**
 * Pull the recovery credential out of the URL.
 *
 * Supabase delivers it three different ways — `?token_hash=` with a customised
 * email template, `?code=` under PKCE, or a `#access_token=…` fragment with the
 * stock template — so all three are read here and handed to the backend, which
 * does the actual exchange.
 */
export function parseRecoveryLink(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  hash: string = typeof window === 'undefined' ? '' : window.location.hash,
): ParsedRecoveryLink {
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));

  const linkError =
    query.get('error_description') ??
    fragment.get('error_description') ??
    query.get('error') ??
    fragment.get('error');
  if (linkError) return { credential: null, linkError };

  const tokenHash = query.get('token_hash');
  if (tokenHash) return { credential: { tokenHash }, linkError: null };

  const code = query.get('code');
  if (code) return { credential: { code }, linkError: null };

  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) {
    return { credential: { accessToken, refreshToken }, linkError: null };
  }

  return { credential: null, linkError: null };
}

/**
 * If a recovery link landed on `/` (or any other path) because Site URL has
 * no `/reset-password`, move it there before React Router sends the user to
 * the dashboard and drops the hash.
 *
 * Returns true when the history entry was rewritten.
 */
export function consumeRecoveryRedirect(
  location: Pick<Location, 'pathname' | 'search' | 'hash'> | undefined = typeof window ===
  'undefined'
    ? undefined
    : window.location,
  replaceState: (url: string) => void = (url) => {
    window.history.replaceState({}, '', url);
  },
): boolean {
  if (!location) return false;
  if (location.pathname === RESET_PATH) return false;
  if (!isRecoveryArrival(location.search, location.hash)) return false;
  replaceState(`${RESET_PATH}${location.search}${location.hash}`);
  return true;
}

/**
 * Read the credential once and keep it across StrictMode remounts after the
 * address bar is scrubbed.
 */
export function takeRecoveryLink(
  search?: string,
  hash?: string,
): ParsedRecoveryLink {
  const fresh = parseRecoveryLink(search, hash);
  if (fresh.credential || fresh.linkError) {
    captured = fresh;
    return fresh;
  }
  return captured ?? fresh;
}
