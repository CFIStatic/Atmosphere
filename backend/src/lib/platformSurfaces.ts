/**
 * Leftover platform APIs that are not the sold Work Verification path.
 *
 * The office UI only ships Verification + Field. The Express process still
 * contains sales, PM, estimator, computer-use, and related routers. Those
 * stay in the tree for a later return — they must not be reachable in
 * production unless an operator explicitly turns them on.
 *
 * Defaults
 *   production:  OFF unless ENABLE_PLATFORM_APIS=true or ENABLE_<SURFACE>=true
 *   development: ON  unless ENABLE_PLATFORM_APIS=false or ENABLE_<SURFACE>=false
 *
 * Per-surface flags (true/false) win over the master switch:
 *   ENABLE_SALES, ENABLE_PM, ENABLE_ESTIMATOR, ENABLE_COMPUTER,
 *   ENABLE_PROSPECTING, ENABLE_EMAIL_MARKETING, ENABLE_FINANCE,
 *   ENABLE_PURCHASING, ENABLE_WEB_ACCESS, ENABLE_CRM, ENABLE_CRM_SYNC,
 *   ENABLE_CYBER, ENABLE_TECHNICIAN, ENABLE_AI, ENABLE_INTEGRATIONS,
 *   ENABLE_BACKUPS, ENABLE_LOCATIONS
 *
 * A comma-separated allowlist also works:
 *   ENABLE_PLATFORM_APIS=sales,pm
 *
 * Local / preview: leave NODE_ENV unset (or development). Every leftover
 * surface stays mounted so existing modules remain exercisable. To mimic
 * production locally:
 *   ENABLE_PLATFORM_APIS=false npm run dev
 */

export const LEFTOVER_SURFACES = [
  'sales',
  'pm',
  'estimator',
  'computer',
  'prospecting',
  'emailMarketing',
  'finance',
  'purchasing',
  'webAccess',
  'crm',
  'crmSync',
  'cyber',
  'technician',
  'ai',
  'integrations',
  'backups',
  'locations',
] as const;

export type LeftoverSurface = (typeof LEFTOVER_SURFACES)[number];

export type LeftoverSurfaceFlags = Record<LeftoverSurface, boolean>;

const ENV_NAME: Record<LeftoverSurface, string> = {
  sales: 'ENABLE_SALES',
  pm: 'ENABLE_PM',
  estimator: 'ENABLE_ESTIMATOR',
  computer: 'ENABLE_COMPUTER',
  prospecting: 'ENABLE_PROSPECTING',
  emailMarketing: 'ENABLE_EMAIL_MARKETING',
  finance: 'ENABLE_FINANCE',
  purchasing: 'ENABLE_PURCHASING',
  webAccess: 'ENABLE_WEB_ACCESS',
  crm: 'ENABLE_CRM',
  crmSync: 'ENABLE_CRM_SYNC',
  cyber: 'ENABLE_CYBER',
  technician: 'ENABLE_TECHNICIAN',
  ai: 'ENABLE_AI',
  integrations: 'ENABLE_INTEGRATIONS',
  backups: 'ENABLE_BACKUPS',
  locations: 'ENABLE_LOCATIONS',
};

const ALLOWLIST_ALIASES: Record<string, LeftoverSurface> = {
  sales: 'sales',
  pm: 'pm',
  estimator: 'estimator',
  mitigation: 'estimator',
  xactimate: 'estimator',
  symbility: 'estimator',
  computer: 'computer',
  'computer-use': 'computer',
  prospecting: 'prospecting',
  emailmarketing: 'emailMarketing',
  'email-marketing': 'emailMarketing',
  finance: 'finance',
  purchasing: 'purchasing',
  webaccess: 'webAccess',
  'web-access': 'webAccess',
  crm: 'crm',
  crmsync: 'crmSync',
  'crm-sync': 'crmSync',
  cyber: 'cyber',
  technician: 'technician',
  ai: 'ai',
  model: 'ai',
  integrations: 'integrations',
  connectors: 'integrations',
  backups: 'backups',
  locations: 'locations',
};

function parseBool(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false;
  return null;
}

function parseAllowlist(raw: string | undefined): Set<LeftoverSurface> | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const asBool = parseBool(trimmed);
  if (asBool !== null) return null;
  const set = new Set<LeftoverSurface>();
  for (const part of trimmed.split(',')) {
    const key = part.trim().toLowerCase();
    const surface = ALLOWLIST_ALIASES[key];
    if (surface) set.add(surface);
  }
  return set;
}

export function allLeftoverSurfaces(enabled: boolean): LeftoverSurfaceFlags {
  return Object.fromEntries(LEFTOVER_SURFACES.map((s) => [s, enabled])) as LeftoverSurfaceFlags;
}

/**
 * Resolve leftover-surface flags from the environment.
 *
 * `isProduction` is passed in so tests can exercise the production default
 * without flipping NODE_ENV (which would poison the config singleton).
 */
export function resolveLeftoverSurfaces(
  env: NodeJS.Dict<string> = process.env,
  isProduction = (env.NODE_ENV ?? 'development') === 'production',
): LeftoverSurfaceFlags {
  const master = parseBool(env.ENABLE_PLATFORM_APIS);
  const allowlist = parseAllowlist(env.ENABLE_PLATFORM_APIS);
  const fallback = isProduction ? false : master === false ? false : true;

  const flags = allLeftoverSurfaces(fallback);
  if (allowlist) {
    for (const surface of LEFTOVER_SURFACES) flags[surface] = allowlist.has(surface);
  } else if (master === true) {
    for (const surface of LEFTOVER_SURFACES) flags[surface] = true;
  }

  for (const surface of LEFTOVER_SURFACES) {
    const override = parseBool(env[ENV_NAME[surface]]);
    if (override !== null) flags[surface] = override;
  }

  return flags;
}

export function leftoverSurfaceEnabled(
  surface: LeftoverSurface,
  env: NodeJS.Dict<string> = process.env,
  isProduction = (env.NODE_ENV ?? 'development') === 'production',
): boolean {
  return resolveLeftoverSurfaces(env, isProduction)[surface];
}

/** Names of leftover surfaces that are currently mounted. */
export function leftoverSurfaceSummary(flags: LeftoverSurfaceFlags): LeftoverSurface[] {
  return LEFTOVER_SURFACES.filter((surface) => flags[surface]);
}
