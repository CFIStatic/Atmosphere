/** The sub's invite page on the office host (same shape as /progress/<token>). */
export function crewInvitePath(token: string, email?: string | null): string {
  const base = `/invite/${encodeURIComponent(token)}`;
  const address = email?.trim().toLowerCase();
  return address ? `${base}?email=${encodeURIComponent(address)}` : base;
}

/**
 * The regular contractor sign-in page for an invited sub: email prefilled,
 * password, "Create an account" — a real account, then back to the invite.
 */
export function crewInviteLoginHref(token: string, email?: string | null): string {
  const params = new URLSearchParams();
  params.set('next', crewInvitePath(token));
  const address = email?.trim().toLowerCase();
  if (address) params.set('email', address);
  return `/login?${params.toString()}`;
}
