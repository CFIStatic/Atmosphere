/**
 * Telling "the credentials are wrong" apart from "the auth service is down".
 *
 * These look identical at the call site — both arrive as an error object from
 * supabase-js — but they must not look identical to the user. Reporting an
 * outage as "invalid email or password" sends people off resetting a password
 * that was never wrong, and hides a real incident behind a support ticket about
 * a forgotten login.
 */
export interface UpstreamError {
  status?: number;
  name?: string;
  message?: string;
}

/**
 * True when the failure is transient — a network blip, a timeout, or an upstream
 * 5xx — rather than a genuine rejection of the caller's credentials.
 *
 * A missing or zero status means the request never got an HTTP response at all
 * (DNS failure, connection refused, blocked egress), which is the shape a real
 * outage takes.
 */
export function isTransient(error: UpstreamError | null | undefined): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  // supabase-js surfaces a non-JSON gateway response as a parse failure; that is
  // an infrastructure problem, never a credential one.
  if (error.message && /not valid JSON|fetch failed|network/i.test(error.message)) return true;
  const status = error.status;
  return status === undefined || status === 0 || status >= 500;
}
