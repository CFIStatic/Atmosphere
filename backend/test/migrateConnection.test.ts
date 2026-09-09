import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const {
  refFromUrl,
  projectRef,
  poolerUrl,
  poolerHost,
  resolveDatabaseUrl,
  managementApiTarget,
  flattenRailwayVariables,
  pickRailwayDbEnv,
  missingConnectionHelp,
} = await import(new URL('../scripts/lib/migrateConnection.mjs', import.meta.url).href);

test('refFromUrl reads the Supabase project ref from the public URL', () => {
  assert.equal(refFromUrl('https://ccxatzfsvzetciiwsjlj.supabase.co'), 'ccxatzfsvzetciiwsjlj');
  assert.equal(refFromUrl('https://abc.supabase.com'), 'abc');
  assert.equal(refFromUrl(''), '');
  assert.equal(refFromUrl('https://example.com'), '');
});

test('projectRef prefers SUPABASE_PROJECT_REF and falls back to SUPABASE_URL', () => {
  assert.equal(projectRef({ SUPABASE_PROJECT_REF: 'explicit', SUPABASE_URL: 'https://other.supabase.co' }), 'explicit');
  assert.equal(projectRef({ SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co' }), 'ccxatzfsvzetciiwsjlj');
  assert.equal(projectRef({}), '');
});

test('resolveDatabaseUrl prefers an explicit URL over the pooler', () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL: 'postgresql://user:pass@host/db',
    SUPABASE_DB_PASSWORD: 'secret',
    SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co',
  });
  assert.deepEqual(resolved, { url: 'postgresql://user:pass@host/db', source: 'DATABASE_URL' });
});

test('poolerHost never invents us-east-1; needs HOST or REGION', () => {
  assert.equal(poolerHost({}), '');
  assert.equal(poolerHost({ SUPABASE_DB_HOST: 'aws-0-us-east-2.pooler.supabase.com' }), 'aws-0-us-east-2.pooler.supabase.com');
  assert.equal(poolerHost({ SUPABASE_DB_REGION: 'us-east-2' }), 'aws-0-us-east-2.pooler.supabase.com');
});

test('resolveDatabaseUrl builds a pooler URL only when host/region is set', () => {
  assert.equal(
    resolveDatabaseUrl({
      SUPABASE_DB_PASSWORD: 's3cret',
      SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co',
    }),
    null,
  );
  const resolved = resolveDatabaseUrl({
    SUPABASE_DB_PASSWORD: 's3cret',
    SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co',
    SUPABASE_DB_HOST: 'aws-0-us-east-2.pooler.supabase.com',
  });
  assert.ok(resolved);
  assert.equal(resolved.source, 'pooler');
  assert.match(resolved.url, /^postgresql:\/\/postgres\.ccxatzfsvzetciiwsjlj:/);
  assert.match(resolved.url, /@aws-0-us-east-2\.pooler\.supabase\.com:6543\/postgres$/);
  assert.equal(
    poolerUrl({
      SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co',
      SUPABASE_DB_HOST: 'aws-0-us-east-2.pooler.supabase.com',
    }),
    '',
  );
});

test('managementApiTarget needs both a token and a project ref', () => {
  assert.equal(managementApiTarget({ SUPABASE_ACCESS_TOKEN: 'sbp_x' }), null);
  assert.deepEqual(
    managementApiTarget({
      SUPABASE_ACCESS_TOKEN: 'sbp_x',
      SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co',
    }),
    { token: 'sbp_x', ref: 'ccxatzfsvzetciiwsjlj' },
  );
});

test('flattenRailwayVariables accepts a flat map and a variables list', () => {
  assert.deepEqual(flattenRailwayVariables({ DATABASE_URL: 'postgresql://x', OTHER: true }), {
    DATABASE_URL: 'postgresql://x',
  });
  assert.deepEqual(
    flattenRailwayVariables({
      variables: [
        { name: 'DATABASE_URL', value: 'postgresql://x' },
        { key: 'SUPABASE_DB_PASSWORD', value: 'pw' },
      ],
    }),
    { DATABASE_URL: 'postgresql://x', SUPABASE_DB_PASSWORD: 'pw' },
  );
});

test('pickRailwayDbEnv copies only connection secrets', () => {
  const picked = pickRailwayDbEnv({
    DATABASE_URL: 'postgresql://x',
    RAILWAY_TOKEN: 'do-not-copy',
    FRONTEND_ORIGIN: 'https://platform.example',
    SUPABASE_ACCESS_TOKEN: 'sbp_x',
    SUPABASE_DB_HOST: 'aws-0-us-east-2.pooler.supabase.com',
  });
  assert.deepEqual(picked, {
    DATABASE_URL: 'postgresql://x',
    SUPABASE_ACCESS_TOKEN: 'sbp_x',
    SUPABASE_DB_HOST: 'aws-0-us-east-2.pooler.supabase.com',
  });
});

test('missingConnectionHelp names the Keys gap, not a generic env dump', () => {
  assert.match(missingConnectionHelp(), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(missingConnectionHelp(), /DATABASE_URL/);
  assert.match(missingConnectionHelp(), /SUPABASE_DB_HOST/);
  assert.match(missingConnectionHelp(), /us-east-2/);
  assert.doesNotMatch(missingConnectionHelp(), /SERVICE_ROLE_KEY can run DDL/);
});

test('deploy installs psql and copies Railway DB secrets before migrate', () => {
  const production = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const backendJob = production.slice(0, production.indexOf('name: Deploy office app'));
  assert.match(backendJob, /postgresql-client/);
  assert.match(backendJob, /loadRailwayDbEnv\.mjs/);
  assert.match(backendJob, /SUPABASE_DB_HOST/);
  assert.ok(backendJob.indexOf('loadRailwayDbEnv.mjs') < backendJob.indexOf('node scripts/migrate.mjs'));
  assert.ok(backendJob.indexOf('postgresql-client') < backendJob.indexOf('node scripts/migrate.mjs'));
  assert.ok(backendJob.indexOf('node scripts/migrate.mjs') < backendJob.indexOf('name: Deploy backend'));
});

test('loadRailwayDbEnv copies DATABASE_URL from Railway JSON on stdin', () => {
  const script = fileURLToPath(new URL('../scripts/loadRailwayDbEnv.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--stdin'], {
    encoding: 'utf8',
    input: JSON.stringify({ DATABASE_URL: 'postgresql://copied/db', RAILWAY_TOKEN: 'nope' }),
    env: {
      ...process.env,
      DATABASE_URL: '',
      SUPABASE_DB_URL: '',
      SUPABASE_DB_PASSWORD: '',
      POSTGRES_PASSWORD: '',
      SUPABASE_ACCESS_TOKEN: '',
      SUPABASE_PROJECT_REF: '',
      SUPABASE_DB_HOST: '',
      SUPABASE_DB_REGION: '',
      GITHUB_ENV: '',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DATABASE_URL=postgresql:\/\/copied\/db$/m);
  assert.doesNotMatch(result.stdout, /RAILWAY_TOKEN/);
  assert.match(`${result.stdout}\n${result.stderr}`, /copied 1 database secret/);
});

test('loadRailwayDbEnv still copies host when Keys only has a password', () => {
  const script = fileURLToPath(new URL('../scripts/loadRailwayDbEnv.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--stdin'], {
    encoding: 'utf8',
    input: JSON.stringify({
      SUPABASE_DB_HOST: 'aws-0-us-east-2.pooler.supabase.com',
      RAILWAY_TOKEN: 'nope',
    }),
    env: {
      ...process.env,
      DATABASE_URL: '',
      SUPABASE_DB_URL: '',
      SUPABASE_DB_PASSWORD: 'keys-only-password',
      POSTGRES_PASSWORD: '',
      SUPABASE_ACCESS_TOKEN: '',
      SUPABASE_URL: 'https://ccxatzfsvzetciiwsjlj.supabase.co',
      SUPABASE_PROJECT_REF: '',
      SUPABASE_DB_HOST: '',
      SUPABASE_DB_REGION: '',
      GITHUB_ENV: '',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^SUPABASE_DB_HOST=aws-0-us-east-2\.pooler\.supabase\.com$/m);
  assert.match(`${result.stdout}\n${result.stderr}`, /copied 1 database secret/);
});

test('migrate.mjs fails closed when no database connection is configured', () => {
  const script = fileURLToPath(new URL('../scripts/migrate.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: '',
      SUPABASE_DB_URL: '',
      DIRECT_URL: '',
      POSTGRES_URL: '',
      DATABASE_PRIVATE_URL: '',
      DATABASE_PUBLIC_URL: '',
      SUPABASE_DB_PASSWORD: '',
      POSTGRES_PASSWORD: '',
      SUPABASE_ACCESS_TOKEN: '',
      SUPABASE_PROJECT_REF: '',
      SUPABASE_URL: '',
      SUPABASE_DB_HOST: '',
      SUPABASE_DB_REGION: '',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no database connection configured/);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('baseline workflow also installs psql and copies Railway DB secrets', () => {
  const baseline = readFileSync(
    new URL('../../.github/workflows/baseline-migrations.yml', import.meta.url),
    'utf8',
  );
  assert.match(baseline, /postgresql-client/);
  assert.match(baseline, /loadRailwayDbEnv\.mjs/);
  assert.match(baseline, /installRailwayCli\.sh/);
  assert.match(baseline, /SUPABASE_DB_HOST/);
  assert.ok(baseline.indexOf('Load database URL from Railway') < baseline.indexOf('Reconcile the live schema'));
});
