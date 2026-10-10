/**
 * Homeowners land on the same Dashboard URL as the office. What they see there
 * is only the jobs shared with their email (the API decides, not the UI).
 */
export const HOMEOWNER_HUB_PATH = '/verifier-library';

/** The old standalone list; now redirects to the Dashboard. */
export const LEGACY_HOMEOWNER_HUB_PATH = '/my-job-files';

/** Legacy hub only — `/verifier-library` still needs a grant check for no-org accounts. */
export function isHomeownerHubPath(pathname: string): boolean {
  return pathname === LEGACY_HOMEOWNER_HUB_PATH || pathname.startsWith(`${LEGACY_HOMEOWNER_HUB_PATH}/`);
}

/** Shell pages an invited homeowner (no org) may open once they hold a live invite. */
export function isHomeownerPortalPath(pathname: string): boolean {
  return pathname === HOMEOWNER_HUB_PATH || pathname === '/settings';
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
