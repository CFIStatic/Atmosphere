export type SupportSession = {
  active: boolean;
  orgName?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  staffEmail?: string | null;
  expiresAt?: string | null;
};

export function supportBannerText(s: SupportSession): string {
  const who = s.userName || s.userEmail || 'this user';
  return `Viewing as ${who} at ${s.orgName || 'their workspace'} (staff support)`;
}
