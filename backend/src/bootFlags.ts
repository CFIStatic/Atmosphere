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
 * Listening on 0.0.0.0 only passes the public probe — office `/api/me` then
 * 504s while https://atmosphere-production.up.railway.app is healthy.
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

export function listenPort(env: NodeJS.Dict<string> = process.env): number {
  const n = Number(env.PORT ?? 4000);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

/** Liveness only — Railway's deploy probe. Readiness stays off until the app loads. */
export function isLivenessProbePath(path: string): boolean {
  return (
    path === '/' ||
    path === '/health' ||
    path === '/api' ||
    path === '/api/' ||
    path === '/api/health'
  );
}

export function isHealthProbePath(path: string): boolean {
  return isLivenessProbePath(path) || path === '/ready' || path === '/api/ready';
}

export function probePathFromUrl(url: string | undefined): string {
  return (url ?? '/').split('?')[0] || '/';
}

/**
 * Tiny request handler used before `createApp()` finishes importing. Config
 * and production guards must not be required to answer GET /api/health —
 * a throw there is what Railway reports as five minutes of "service unavailable".
 */
export function createLivenessListener(): import('node:http').RequestListener {
  return (req, res) => {
    const path = probePathFromUrl(req.url);
    const method = req.method ?? 'GET';
    if ((method === 'GET' || method === 'HEAD') && isLivenessProbePath(path)) {
      const body = JSON.stringify({
        status: 'ok',
        service: 'atmosphere-backend',
        time: new Date().toISOString(),
      });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      res.end(method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('starting');
  };
}
