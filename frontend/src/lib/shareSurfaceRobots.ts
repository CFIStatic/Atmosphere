/**
 * Paths (and Verifier share URLs) that carry bearer/share credentials and
 * must not be indexed. Keep in sync with frontend/nginx/default.conf.template
 * X-Robots-Tag locations.
 */
export const SHARE_SURFACE_ROBOTS = 'noindex, nofollow, noarchive';

export function isShareSurfacePath(pathname: string, search = ''): boolean {
  const path = pathname || '/';
  if (
    path === '/progress' ||
    path.startsWith('/progress/') ||
    path === '/progress-view' ||
    path.startsWith('/progress-view/') ||
    path === '/shared' ||
    path.startsWith('/shared/') ||
    path === '/verifier/shared' ||
    path.startsWith('/verifier/shared/')
  ) {
    return true;
  }
  if (path === '/verifier' || path === '/verifier/' || path.startsWith('/verifier/')) {
    try {
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      if (params.get('share')) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
