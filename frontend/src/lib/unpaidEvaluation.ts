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

/**
 * An unpaid workspace whose person holds a live job share opens that job
 * instead of first-run setup or plans. Null when there is none (or the lookup
 * failed), so a real unpaid office still goes to setup.
 */
export async function sharedJobInsteadOfSetup(
  lookup: () => Promise<{ grants: Array<{ path?: string | null }> }>,
): Promise<string | null> {
  try {
    const { grants } = await lookup();
    const path = grants.find((g) => typeof g.path === 'string' && g.path.startsWith('/'))?.path;
    return path ?? null;
  } catch {
    return null;
  }
}
