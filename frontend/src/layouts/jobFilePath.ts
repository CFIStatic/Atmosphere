/** Job Files profile (`/jobs/:id`) — Ask docks on the right on desktop. */
export function isJobFilePath(pathname: string): boolean {
  return /^\/jobs\/[^/]+/.test(pathname);
}

/** Dashboard / Field Capture open a job as `/job-progress?job=`. */
export function isJobProgressFile(pathname: string, search = ''): boolean {
  if (pathname !== '/job-progress') return false;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return Boolean(new URLSearchParams(query).get('job'));
}

/**
 * Full-height file chrome: the Job Files profile always, and the Dashboard
 * job on a phone so File / Ask can fill the Field Capture frame.
 */
export function isFullHeightJobFile(
  pathname: string,
  search = '',
  phone = false,
): boolean {
  return isJobFilePath(pathname) || (phone && isJobProgressFile(pathname, search));
}
