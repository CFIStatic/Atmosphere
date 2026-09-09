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
  'SUPABASE_ACCESS_TOKEN',
];

export function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url || '');
  return m ? m[1] : '';
}

export function projectRef(env = process.env) {
  return (env.SUPABASE_PROJECT_REF || '').trim() || refFromUrl(env.SUPABASE_URL || '');
}

export function poolerUrl(env = process.env) {
  const ref = projectRef(env);
  const password = env.SUPABASE_DB_PASSWORD || env.POSTGRES_PASSWORD || '';
  if (!ref || !password) return '';
  const user = env.SUPABASE_DB_USER || `postgres.${ref}`;
  const host = env.SUPABASE_DB_HOST || 'aws-0-us-east-1.pooler.supabase.com';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:6543/postgres`;
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
  return (
    'no database connection configured. Set DATABASE_URL (or SUPABASE_DB_PASSWORD +\n' +
    '  SUPABASE_PROJECT_REF / SUPABASE_URL for the pooler), or SUPABASE_ACCESS_TOKEN + project ref.\n' +
    '  GitHub Keys currently has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY only — those cannot\n' +
    '  run DDL. Add DATABASE_URL, SUPABASE_DB_PASSWORD, or SUPABASE_ACCESS_TOKEN to Keys, or\n' +
    '  put one of those on the Railway backend service so the deploy can copy it.'
  );
}
