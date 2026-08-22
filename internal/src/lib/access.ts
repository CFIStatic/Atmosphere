export type AnalyticsScope = 'investor' | 'internal';

export function canSeeAccounts(scope: AnalyticsScope | null | undefined): boolean {
  return scope === 'internal';
}

export function canManageAccess(scope: AnalyticsScope | null | undefined): boolean {
  return scope === 'internal';
}

export function landingPath(scope: AnalyticsScope | null | undefined): string {
  if (scope === 'internal') return '/overview';
  if (scope === 'investor') return '/overview';
  return '/login';
}
