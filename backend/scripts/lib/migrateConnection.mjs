/**
 * Shared connection resolution for migrate.mjs and reconcile-migrations.mjs.
 *
 * GitHub Keys currently carries SUPABASE_URL + SERVICE_ROLE_KEY, which is
 * enough for PostgREST but not for DDL. The runner needs a Postgres URL,
 * a DB password (to build the pooler URL), or a Supabase personal access
 * token. This module only decides which of those is present — it never
 * prints secret values.
 */

export const DATABASE_URL_KEYS = [
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'DIRECT_URL',
  'POSTGRES_URL',
  'DATABASE_PRIVATE_URL',
  'DATABASE_PUBLIC_URL',
];

export const DATABASE_PASSWORD_KEYS = ['SUPABASE_DB_PASSWORD', 'POSTGRES_PASSWORD'];

export const RAILWAY_COPY_KEYS = [
  ...DATABASE_URL_KEYS,
  ...DATABASE_PASSWORD_KEYS,
  'SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_USER',
  'SUPABASE_DB_HOST',
  'SUPABASE_DB_REGION',
  'SUPABASE_ACCESS_TOKEN',
];

export function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url || '');
  return m ? m[1] : '';
}

export function projectRef(env = process.env) {
  return (env.SUPABASE_PROJECT_REF || '').trim() || refFromUrl(env.SUPABASE_URL || '');
}

/** Pooler hostname from SUPABASE_DB_HOST or SUPABASE_DB_REGION — never guess us-east-1. */
export function poolerHost(env = process.env) {
  const explicit = String(env.SUPABASE_DB_HOST || '').trim();
  if (explicit) return explicit;
  const region = String(env.SUPABASE_DB_REGION || '').trim();
  if (region) return `aws-0-${region}.pooler.supabase.com`;
  return '';
}

/** Session-mode pooler URL (port 5432). Prefer this over transaction 6543 for DDL. */
export function poolerUrl(env = process.env) {
  const ref = projectRef(env);
  const password = String(env.SUPABASE_DB_PASSWORD || env.POSTGRES_PASSWORD || '').trim();
  const host = poolerHost(env);
  if (!ref || !password || !host) return '';
  const user = String(env.SUPABASE_DB_USER || `postgres.${ref}`).trim();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

/**
 * First configured Postgres URL, or null.
 * `source` is the env key (or `pooler`) that produced it — safe to log.
 */
export function resolveDatabaseUrl(env = process.env) {
  for (const key of DATABASE_URL_KEYS) {
    const value = String(env[key] || '').trim();
    if (value) return { url: value, source: key };
  }
  const constructed = poolerUrl(env);
  if (constructed) return { url: constructed, source: 'pooler' };
  return null;
}

export function managementApiTarget(env = process.env) {
  const token = String(env.SUPABASE_ACCESS_TOKEN || '').trim();
  const ref = projectRef(env);
  if (!token || !ref) return null;
  return { token, ref };
}

/** Accept both `{ KEY: value }` and `{ variables: [{ name, value }] }`. */
export function flattenRailwayVariables(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .filter((item) => item && (item.name || item.key) && item.value != null)
        .map((item) => [String(item.name || item.key), String(item.value)]),
    );
  }
  if (Array.isArray(raw.variables) || Array.isArray(raw.data?.variables)) {
    return flattenRailwayVariables(raw.variables || raw.data.variables);
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
  }
  return out;
}

export function pickRailwayDbEnv(vars) {
  const flat = flattenRailwayVariables(vars);
  const env = {};
  for (const key of RAILWAY_COPY_KEYS) {
    if (flat[key]) env[key] = flat[key];
  }
  return env;
}

export function missingConnectionHelp() {
  return [
    'no database connection configured. Prefer SUPABASE_ACCESS_TOKEN + SUPABASE_URL /',
    '  SUPABASE_PROJECT_REF (Management API — works from GitHub Actions without the pooler).',
    '  Or set DATABASE_URL, or SUPABASE_DB_PASSWORD + SUPABASE_DB_HOST / REGION + project ref.',
    '  GitHub Keys SERVICE_ROLE_KEY cannot run DDL.',
    '  Atmosphere pooler host is aws-0-us-east-2.pooler.supabase.com (session port 5432).',
  ].join('\n');
}
