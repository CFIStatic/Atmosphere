/** A job file — Ask docks to the right edge, so the shell drops page padding. */
export function isJobFilePath(pathname: string): boolean {
  return pathname === '/job-progress' || /^\/jobs\/[^/]+/.test(pathname);
}
