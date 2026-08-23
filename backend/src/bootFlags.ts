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
 * Railway (and most PaaS healthchecks) probe IPv4. Listening on 127.0.0.1
 * or IPv6-only `::` makes the process look down: "service unavailable".
 */
export function listenHost(env: NodeJS.Dict<string> = process.env): string {
  const raw = env.HOST?.trim();
  if (!raw || raw === 'localhost' || raw === '127.0.0.1' || raw === '::1') {
    return '0.0.0.0';
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

/**
 * Railway services whose Config File was never pointed at their own
 * `railway.toml`, keyed by the surface they should be running.
 *
 * A service with no Config File resolves the repo-root config on GitHub
 * autodeploys — and that config names the repo-root `Dockerfile`, so the
 * service does not merely inherit the backend's start command and probe, it
 * BUILDS AND RUNS THE BACKEND. The first required backend variable then kills
 * it: `Missing required environment variable: SUPABASE_URL`, five minutes of
 * `Network > Healthcheck`, `Deployment failed during network process`.
 *
 * Read bare, that error says the marketing site needs a Supabase URL. It does
 * not — adding one would only get the BFF listening on the marketing domain.
 * Names are matched loosely because the canvas names and the CLI aliases drift
 * (see backend/scripts/resolveRailwayService.mjs).
 */
const SURFACE_CONFIG_FILES: ReadonlyArray<readonly [RegExp, string]> = [
  [/corporate\s*website|^website$|atmosphere[\s_-]*website/i, '/website/railway.toml'],
  [/login\s*&\s*dashboard|atmosphere[\s_-]*web$/i, '/frontend/railway.toml'],
  [
    /internal\s*growth\s*metrics|atmosphere[\s_-]*internal|melodious[\s_-]*inspiration/i,
    '/internal/railway.json',
  ],
];

/**
 * Explain a backend boot failure that is really a Railway misconfiguration.
 *
 * Returns '' on the API service itself, and off Railway, so a genuinely
 * missing backend variable still fails with the plain message.
 */
export function misresolvedServiceHint(env: NodeJS.Dict<string> = process.env): string {
  const service = env.RAILWAY_SERVICE_NAME?.trim();
  if (!service) return '';
  const match = SURFACE_CONFIG_FILES.find(([pattern]) => pattern.test(service));
  if (!match) return '';
  const configFile = match[1];
  return [
    `This is the Atmosphere backend image (node dist/index.js) — but it is running on Railway service "${service}", which serves a static nginx site.`,
    `That service has no Config File, so its GitHub autodeploy resolved the repo-root /railway.toml and built the repo-root Dockerfile (the BFF) instead of ${configFile}.`,
    `Fix the service, not the variables: Railway -> ${service} -> Settings -> Config-as-code -> Config File = ${configFile}, then redeploy. Do NOT add backend secrets to this service.`,
    'See docs/production.md -> "If the website service fails its healthcheck on every main push".',
  ].join('\n');
}
