#!/usr/bin/env node
/**
 * Copy Postgres connection secrets from the Railway backend service into
 * GITHUB_ENV (or print KEY=value on stdout when that file is unset).
 *
 * The migrate / reconcile runners need a real database URL. Deploy Keys
 * has the Supabase REST pair, not DDL credentials. If the live backend
 * service already has DATABASE_URL / SUPABASE_DB_PASSWORD / a personal
 * access token, reuse it rather than failing for a secret that exists
 * one hop away.
 *
 * Never prints secret values. Missing Railway access is a warning — the
 * runner still fails closed if nothing is configured.
 *
 *   node scripts/loadRailwayDbEnv.mjs
 *   railway variables --json --service "$id" | node scripts/loadRailwayDbEnv.mjs --stdin
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pickRailwayDbEnv, resolveDatabaseUrl, managementApiTarget } from './lib/migrateConnection.mjs';

const fromStdin = process.argv.includes('--stdin');

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
  });
}

function railwayVariablesJson() {
  const project = process.env.RAILWAY_PROJECT_ID || 'd0af58bd-0eec-431d-bad3-4da4b4a2e2ae';
  const environment = process.env.RAILWAY_ENVIRONMENT || 'production';
  const service = process.env.RAILWAY_SERVICE || 'Atmosphere APIs';
  const attempts = [
    ['variables', '--json', '--service', service, '--project', project, '--environment', environment],
    ['variables', '--json', '--service', service, '--environment', environment],
  ];
  for (const args of attempts) {
    const result = spawnSync('railway', args, { encoding: 'utf8' });
    const raw = (result.stdout || '').trim();
    if (result.status === 0 && raw) return raw;
  }
  return '';
}

function writeEnv(env) {
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(githubEnv, `${lines.join('\n')}\n`);
    return;
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function alreadyHasConnection() {
  return Boolean(resolveDatabaseUrl(process.env) || managementApiTarget(process.env));
}

async function main() {
  if (alreadyHasConnection()) {
    const via = resolveDatabaseUrl(process.env)?.source || 'SUPABASE_ACCESS_TOKEN';
    console.log(`migrate-env: Keys already has a database connection (${via}); not copying from Railway.`);
    return;
  }

  const raw = fromStdin ? await readStdin() : railwayVariablesJson();
  if (!raw) {
    console.warn(
      'migrate-env: could not read Railway variables. Add DATABASE_URL, SUPABASE_DB_PASSWORD, or SUPABASE_ACCESS_TOKEN to GitHub Keys.',
    );
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('migrate-env: Railway variables were not JSON; not copying anything.');
    return;
  }

  const picked = pickRailwayDbEnv(parsed);
  const keys = Object.keys(picked);
  if (keys.length === 0) {
    console.warn(
      'migrate-env: Railway backend has no DATABASE_URL / SUPABASE_DB_PASSWORD / SUPABASE_ACCESS_TOKEN.',
    );
    return;
  }

  const merged = { ...process.env, ...picked };
  const via = resolveDatabaseUrl(merged)?.source || (managementApiTarget(merged) ? 'SUPABASE_ACCESS_TOKEN' : null);
  if (!via) {
    console.warn(`migrate-env: copied ${keys.join(', ')} from Railway but still no usable connection.`);
    return;
  }

  writeEnv(picked);
  console.log(`migrate-env: copied ${keys.length} database secret(s) from Railway (${via}).`);
}

main().catch((err) => {
  console.warn(`migrate-env: ${err instanceof Error ? err.message : String(err)}`);
});
