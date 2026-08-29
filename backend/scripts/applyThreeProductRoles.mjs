#!/usr/bin/env node
/**
 * Apply Global Admin / Employee product-role migrations on Supabase.
 *
 * Railway does not run migrations on boot. Without these:
 *   - create_org / invites using global_admin | employee fail on the enum
 *   - can_manage_billing still allows legacy office seats
 *   - join invite gating in SQL (org_members_guard_product_seat) is missing
 *
 * Two files, applied in order — new enum values must commit before remap DML.
 *
 * Tries, in order:
 *   1. Management API with SUPABASE_ACCESS_TOKEN (sbp_… personal token)
 *   2. Management API with SUPABASE_SERVICE_ROLE_KEY when it is an sbp_ token
 *   3. psql via DATABASE_URL / SUPABASE_DB_URL / constructed pooler URL
 *
 * Missing credentials skip with a warning so a Railway-only deploy still runs.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  '20260829213000_three_product_roles.sql',
  '20260829213100_three_product_roles_remap.sql',
].map((name) => ({
  name,
  path: join(here, '../supabase/migrations', name),
  sql: readFileSync(join(here, '../supabase/migrations', name), 'utf8'),
}));

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function applyViaManagementApi(token, ref, label, file) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: file.sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    // Idempotent: enum value already present / objects already updated.
    if (/already exists|duplicate_object|23505/i.test(body)) {
      console.log(`${file.name}: already applied (${label}).`);
      return true;
    }
    console.warn(
      `${label} Management API apply failed for ${file.name} (${res.status}): ${body.slice(0, 500)}`,
    );
    return false;
  }
  console.log(`Applied ${file.name} via ${label} Management API.`);
  return true;
}

function applyViaPsql(dbUrl, label, file) {
  const tmp = join(tmpdir(), `atmosphere-${file.name}`);
  writeFileSync(tmp, file.sql);
  try {
    const psql = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', tmp], {
      encoding: 'utf8',
    });
    if (psql.status !== 0) {
      const err = psql.stderr || psql.stdout || 'psql failed';
      if (/already exists|duplicate_object/i.test(err)) {
        console.log(`${file.name}: already applied (${label}).`);
        return true;
      }
      console.warn(`${label} psql failed for ${file.name}: ${err.slice(0, 500)}`);
      return false;
    }
    console.log(`Applied ${file.name} via ${label}.`);
    return true;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function applyAll(applyOne) {
  for (const file of files) {
    const ok = await applyOne(file);
    if (!ok) return false;
  }
  return true;
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(supabaseUrl);
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';

if (
  accessToken &&
  ref &&
  (await applyAll((file) => applyViaManagementApi(accessToken, ref, 'SUPABASE_ACCESS_TOKEN', file)))
) {
  process.exit(0);
}

if (
  serviceRole.startsWith('sbp_') &&
  ref &&
  (await applyAll((file) => applyViaManagementApi(serviceRole, ref, 'service_role', file)))
) {
  process.exit(0);
}

if (dbUrl && (await applyAll((file) => applyViaPsql(dbUrl, 'DATABASE_URL', file)))) {
  process.exit(0);
}

if (ref && dbPassword) {
  const user = process.env.SUPABASE_DB_USER || `postgres.${ref}`;
  const host = process.env.SUPABASE_DB_HOST || `aws-0-us-east-1.pooler.supabase.com`;
  const poolerUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:6543/postgres`;
  if (await applyAll((file) => applyViaPsql(poolerUrl, 'pooler', file))) {
    process.exit(0);
  }
}

console.warn(
  'Skipping three-product-roles SQL apply — add SUPABASE_ACCESS_TOKEN (or DATABASE_URL / SUPABASE_DB_PASSWORD) to Keys so Global Admin / Employee seats work in production.',
);
