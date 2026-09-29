/**
 * Routes an unpaid office can open so they can see the first job, the invite
 * panel, and the homeowner-share flow before paying. Everything else still
 * goes to plan selection.
 */

export function isUnpaidEvaluationLocation(pathname: string, search = ''): boolean {
  if (pathname === '/job-progress' || pathname === '/welcome') return true;
  if (/^\/jobs\/[^/]+$/.test(pathname)) return true;
  if (pathname === '/settings') {
    const section = new URLSearchParams(search).get('section');
    return section === 'organization';
  }
  return false;
}
