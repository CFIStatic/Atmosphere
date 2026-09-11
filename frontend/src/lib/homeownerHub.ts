/** Platform home for grant-only homeowners — not `/my-jobs` (subs / field identity). */
export const HOMEOWNER_HUB_PATH = '/my-job-files';

export function isHomeownerHubPath(pathname: string): boolean {
  return pathname === HOMEOWNER_HUB_PATH || pathname.startsWith(`${HOMEOWNER_HUB_PATH}/`);
}

/** Progress guest, claimed job file, or the homeowner hub. */
export function isHomeownerViewerPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const pathname = (path.split(/[?#]/)[0] ?? path).trim();
  if (!pathname.startsWith('/')) return false;
  return (
    pathname === '/job-progress' ||
    pathname.startsWith('/jobs/') ||
    pathname === '/progress' ||
    pathname.startsWith('/progress/') ||
    isHomeownerHubPath(pathname)
  );
}

const GRANT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/** After homeowner signup: keep a job/progress deep link; otherwise the hub. */
export function homeownerAfterSignup(redirectTo: string): string {
  return isHomeownerViewerPath(redirectTo) ? redirectTo : HOMEOWNER_HUB_PATH;
}

export function grantStatusLabel(status: string | null | undefined): string | null {
  if (!status?.trim()) return null;
  return GRANT_STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}
