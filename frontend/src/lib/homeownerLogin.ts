/** The shared sign-in page, set up for an invited homeowner opening a share link. */
export function homeownerLoginHref(token: string, email: string | null | undefined): string {
  const params = new URLSearchParams();
  params.set('next', `/progress/${encodeURIComponent(token)}`);
  params.set('share', token);
  if (email) params.set('email', email);
  return `/login?${params.toString()}`;
}

/** A progress share token from the login page's ?share= param, if it looks like one. */
export function shareTokenFromLogin(value: string | null): string | null {
  const t = value?.trim() ?? '';
  return /^[A-Za-z0-9_-]{16,128}$/.test(t) ? t : null;
}
