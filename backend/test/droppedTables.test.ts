/**
 * Regression: code must not query tables that migrations dropped.
 *
 * Oct 19 2026: update_project_graph still read public.project_timeline_events,
 * dropped by 20260910190000_drop_unused_non_sold_path_tables.sql, so every
 * verification video failed. This test replays every migration (archive +
 * current, in filename order), works out which public tables are dropped and
 * not re-created, and fails if backend code calls .from('<that table>').
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const MIGRATION_DIRS = ['supabase/migrations_archive', 'supabase/migrations'].map((d) => join(ROOT, d));
const SRC = join(ROOT, 'backend', 'src');

/**
 * Known references outside the verification pipeline, kept so this test can
 * land; each is guarded at runtime and tracked for removal. Do not add to it.
 */
const KNOWN_LEGACY: Record<string, string[]> = {
  'shared/askCrm.ts': [
    'crm_contacts',
    'crm_external_records',
    'crm_external_sources',
    'crm_job_links',
    'crm_oauth_grants',
    'crm_sync_connections',
  ],
};

function sqlFiles(): string[] {
  const out: Array<{ name: string; path: string }> = [];
  for (const dir of MIGRATION_DIRS) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) if (name.endsWith('.sql')) out.push({ name, path: join(dir, name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.path);
}

export function droppedTables(): Set<string> {
  const live = new Set<string>();
  const dropped = new Set<string>();
  const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  const drop = /drop\s+table\s+(?:if\s+exists\s+)?((?:(?:public\.)?"?[a-z_][a-z0-9_]*"?\s*,?\s*)+)/gi;
  const rename = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi;
  for (const file of sqlFiles()) {
    const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    const events: Array<{ at: number; kind: 'c' | 'd' | 'r'; a: string; b?: string }> = [];
    for (const m of sql.matchAll(create)) events.push({ at: m.index ?? 0, kind: 'c', a: m[1].toLowerCase() });
    for (const m of sql.matchAll(drop)) {
      // Skip non-public schemas (archive.x etc.).
      const names = m[1]
        .split(',')
        .map((n) => n.trim().split(/\s+/)[0] ?? '')
        .filter((n) => !/^(cascade|restrict)$/i.test(n))
        .filter((n) => n && (!n.includes('.') || n.toLowerCase().startsWith('public.')))
        .map((n) => n.replace(/^public\./i, '').replace(/"/g, '').trim().toLowerCase());
      for (const n of names) events.push({ at: m.index ?? 0, kind: 'd', a: n });
    }
    for (const m of sql.matchAll(rename)) events.push({ at: m.index ?? 0, kind: 'r', a: m[1].toLowerCase(), b: m[2].toLowerCase() });
    events.sort((x, y) => x.at - y.at);
    for (const e of events) {
      if (e.kind === 'c') {
        live.add(e.a);
        dropped.delete(e.a);
      } else if (e.kind === 'd') {
        live.delete(e.a);
        dropped.add(e.a);
      } else if (e.b) {
        live.delete(e.a);
        dropped.add(e.a);
        live.add(e.b);
        dropped.delete(e.b);
      }
    }
  }
  return dropped;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test('the drop migration is seen (sanity)', () => {
  const dropped = droppedTables();
  assert.ok(dropped.has('project_timeline_events'));
  assert.ok(!dropped.has('verification_videos'));
  assert.ok(!dropped.has('job_proofs'));
});

test('backend code never queries a dropped table', () => {
  const dropped = droppedTables();
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g)) {
      const table = m[1];
      if (!dropped.has(table)) continue;
      if (KNOWN_LEGACY[rel]?.includes(table)) continue;
      offenders.push(`${rel}: ${table}`);
    }
  }
  assert.deepEqual(offenders, [], `queries against dropped tables:\n${offenders.join('\n')}`);
});

test('verification pipeline has no legacy exceptions', () => {
  for (const rel of Object.keys(KNOWN_LEGACY)) assert.ok(!rel.startsWith('verification/'));
});
