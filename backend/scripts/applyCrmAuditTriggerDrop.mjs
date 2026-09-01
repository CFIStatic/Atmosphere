#!/usr/bin/env node
/**
 * Drop leftover CRM audit triggers that break soft-delete of job files.
 *
 * public.crm_audit_log was removed with the old CRM product, but
 * private.crm_audit() triggers on crm_jobs / crm_properties remained.
 * Updating deleted_at then fails with:
 *   relation "public.crm_audit_log" does not exist
 *
 * Railway does not run migrations on boot. This script applies the repair
 * SQL on deploy (and via the repair workflow) when Keys has DB credentials.
 *
 * Tries, in order:
 *   1. Management API with SUPABASE_ACCESS_TOKEN (sbp_… personal token)
 *   2. Management API with SUPABASE_SERVICE_ROLE_KEY when it is an sbp_ token
 *   3. psql via DATABASE_URL / SUPABASE_DB_URL / constructed pooler URL
 *
 * Missing credentials skip with a warning so a Railway-only deploy still runs.
 * The BFF also calls repair_crm_audit_triggers() (and falls back to a
 * memory_events tombstone) so Delete permanently works even when this skip.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(
  here,
  '../supabase/migrations/20260901030000_repair_crm_audit_for_job_delete.sql',
);
const sql = readFileSync(sqlPath, 'utf8');

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function applyViaManagementApi(token, ref, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.warn(`${label} Management API apply failed (${res.status}): ${body.slice(0, 500)}`);
    return false;
  }
  console.log(`Dropped leftover CRM audit triggers via ${label} Management API.`);
  return true;
}

function applyViaPsql(dbUrl, label) {
  const psql = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
    encoding: 'utf8',
  });
  if (psql.status !== 0) {
    console.warn(`${label} psql failed: ${(psql.stderr || psql.stdout || 'psql failed').slice(0, 500)}`);
    return false;
  }
  console.log(`Dropped leftover CRM audit triggers via ${label}.`);
  return true;
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(supabaseUrl);
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';

if (accessToken && ref && (await applyViaManagementApi(accessToken, ref, 'SUPABASE_ACCESS_TOKEN'))) {
  process.exit(0);
}

// Prefer an sbp_ personal token, but also try whatever is in SERVICE_ROLE_KEY —
// some Keys setups store the management token there by mistake, and a failed
// attempt is cheap compared to a broken Delete button.
if (
  serviceRole &&
  ref &&
  (await applyViaManagementApi(
    serviceRole,
    ref,
    serviceRole.startsWith('sbp_') ? 'service_role' : 'SUPABASE_SERVICE_ROLE_KEY',
  ))
) {
  process.exit(0);
}

if (dbUrl && applyViaPsql(dbUrl, 'DATABASE_URL')) {
  process.exit(0);
}

if (ref && dbPassword) {
  const user = process.env.SUPABASE_DB_USER || `postgres.${ref}`;
  const host = process.env.SUPABASE_DB_HOST || `aws-0-us-east-1.pooler.supabase.com`;
  const poolerUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:6543/postgres`;
  if (applyViaPsql(poolerUrl, 'pooler')) {
    process.exit(0);
  }
}

console.warn(
  'Skipping CRM audit-trigger drop — add SUPABASE_ACCESS_TOKEN (or DATABASE_URL / SUPABASE_DB_PASSWORD) to Keys so job-file delete can soft-delete without writing to the removed crm_audit_log.',
);
