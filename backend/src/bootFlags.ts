/**
 * Boot-time flags that must be safe to evaluate without importing the full
 * config singleton (tests, and production deploys that omit optional secrets).
 */

export function resolveComputerUseEnabled(
  env: NodeJS.Dict<string> = process.env,
  isProduction = (env.NODE_ENV ?? 'development') === 'production',
): boolean {
  if ((env.COMPUTER_USE_ENABLED ?? 'true') === 'false') return false;
  // Computer-use needs a vault key and agent token secret. Missing either
  // must not take down Work Verification — disable the feature instead.
  if (isProduction && (!env.AI_CREDENTIALS_KEY?.trim() || !env.AGENT_TOKEN_SECRET?.trim())) {
    return false;
  }
  return true;
}

export function resolveBackupsEnabled(
  env: NodeJS.Dict<string> = process.env,
  isProduction = (env.NODE_ENV ?? 'development') === 'production',
): boolean {
  if ((env.BACKUP_ENABLED ?? 'true') === 'false') return false;
  if (isProduction && !env.BACKUP_ENCRYPTION_KEY?.trim()) return false;
  return true;
}

/**
 * Railway's public healthcheck is IPv4. The private mesh (office nginx
 * `API_UPSTREAM`) is IPv6. Listening on 127.0.0.1 hides the process from both.
 * Listening on 0.0.0.0 only passes the public probe — office `/api/auth/login`
 * then 504s while https://atmosphere-production.up.railway.app is healthy.
 * `::` with ipv6Only=false is dual-stack on Linux.
 */
export function listenHost(env: NodeJS.Dict<string> = process.env): string {
  const raw = env.HOST?.trim();
  if (
    !raw ||
    raw === 'localhost' ||
    raw === '127.0.0.1' ||
    raw === '::1' ||
    raw === '0.0.0.0'
  ) {
    return '::';
  }
  return raw;
}

export function isHealthProbePath(path: string): boolean {
  return (
    path === '/' ||
    path === '/health' ||
    path === '/ready' ||
    path === '/api' ||
    path === '/api/' ||
    path === '/api/health' ||
    path === '/api/ready'
  );
}
