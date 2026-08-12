/**
 * Paths the demo interceptor must not shadow when a live backend is reachable.
 * Settings, the account chip, and the Dashboard library should show the
 * signed-in org — not the Dana Ortiz fixture.
 */
export function isLiveFirstPath(path: string): boolean {
  if (/^\/api\/auth(\/|$)/.test(path)) return true;
  if (path === '/api/profile') return true;
  if (/^\/api\/org(\/|$)/.test(path)) return true;
  if (path === '/api/evidence-portal/library') return true;
  if (path === '/api/operations/shared') return true;
  if (/^\/api\/operations\/shared\/[^/]+$/.test(path)) return true;
  if (/^\/api\/operations\/shared\/[^/]+\/proof$/.test(path)) return true;
  return false;
}
