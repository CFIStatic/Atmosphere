#!/usr/bin/env node
/**
 * Apply the memory-capture repair SQL to the linked Supabase project.
 *
 * Migrations are not applied by Railway on boot. Start a job fails until
 * `memory_events_job_id_fkey` is dropped and `memory.capture()` can no longer
 * abort a crm_jobs insert. This script is the deploy-time apply.
 *
 * Credentials (any one path is enough), from GitHub environment Keys:
 *   SUPABASE_ACCESS_TOKEN + SUPABASE_URL (or SUPABASE_PROJECT_REF)
 *   DATABASE_URL / SUPABASE_DB_URL
 *
 * Missing credentials skip with a warning so a Railway-only deploy still runs.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(
  here,
  '../supabase/migrations/20260818193000_memory_capture_never_blocks_jobs.sql',
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

const token = process.env.SUPABASE_ACCESS_TOKEN || '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(supabaseUrl);
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

if (token && ref) {
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
    console.error(`Supabase SQL apply failed (${res.status}): ${body.slice(0, 2000)}`);
    process.exit(1);
  }
  console.log('Applied memory capture repair via Supabase Management API.');
  process.exit(0);
}

if (dbUrl) {
  const psql = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
    encoding: 'utf8',
  });
  if (psql.status !== 0) {
    console.error(psql.stderr || psql.stdout || 'psql failed');
    process.exit(psql.status ?? 1);
  }
  console.log('Applied memory capture repair via DATABASE_URL.');
  process.exit(0);
}

console.warn(
  'Skipping memory capture SQL apply — set SUPABASE_ACCESS_TOKEN + SUPABASE_URL, or DATABASE_URL, in Keys.',
);
