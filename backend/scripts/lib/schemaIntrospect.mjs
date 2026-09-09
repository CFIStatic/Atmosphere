/**
 * Read the set of durable objects a Postgres database actually contains.
 *
 * Shared by the manifest generator (which snapshots a scratch database after
 * each migration) and the reconciler (which reads production). Both must see
 * the schema the same way or the comparison is meaningless, so there is one
 * query and one normalisation, here.
 *
 * Objects are returned as a Set of `kind|identifier` strings. The identifier is
 * always schema-qualified so `public.jobs` and `storage.jobs` never collide.
 *
 * Anything that belongs to a table carries that table in its identifier —
 * `index|public.job_proofs.job_proofs_pkey`, not `index|public.job_proofs_pkey`.
 * Two things depend on that: collapsing a missing table's children into one
 * finding, and deciding whether an object could have come from more than one
 * migration (which is keyed on the owning table, because an implicit primary
 * key index is named in no migration at all).
 *
 * Functions are recorded by name without their argument types. Overloads
 * therefore collapse to one entry: a migration that adds an overload of an
 * existing function contributes nothing detectable. That is deliberate. The
 * alternative, matching on argument types, produces false "missing" reports
 * whenever a later migration changes a signature, and a false missing is the
 * one outcome this tool must never produce.
 */

import { spawnSync } from 'node:child_process';

const INTROSPECT_SQL = `
select 'schema|' || nspname
  from pg_namespace
 where nspname not like 'pg\\_%' and nspname <> 'information_schema'
union all
select 'table|' || schemaname || '.' || tablename
  from pg_tables where schemaname not in ('pg_catalog','information_schema')
union all
select 'view|' || schemaname || '.' || viewname
  from pg_views where schemaname not in ('pg_catalog','information_schema')
union all
select 'matview|' || schemaname || '.' || matviewname
  from pg_matviews where schemaname not in ('pg_catalog','information_schema')
union all
select 'column|' || table_schema || '.' || table_name || '.' || column_name
  from information_schema.columns
 where table_schema not in ('pg_catalog','information_schema')
union all
select 'function|' || n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog','information_schema')
union all
select 'index|' || schemaname || '.' || tablename || '.' || indexname
  from pg_indexes where schemaname not in ('pg_catalog','information_schema')
union all
select 'policy|' || schemaname || '.' || tablename || '.' || policyname
  from pg_policies where schemaname not in ('pg_catalog','information_schema')
union all
select 'type|' || n.nspname || '.' || t.typname
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
 where t.typtype in ('e','d')
   and n.nspname not in ('pg_catalog','information_schema')
union all
select 'trigger|' || n.nspname || '.' || c.relname || '.' || tg.tgname
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where not tg.tgisinternal
   and n.nspname not in ('pg_catalog','information_schema')
union all
select 'rls|' || n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relrowsecurity and n.nspname not in ('pg_catalog','information_schema')
`;

/** Object kinds, in the order a report should mention them. */
export const KINDS = [
  'schema',
  'table',
  'view',
  'matview',
  'column',
  'type',
  'function',
  'index',
  'policy',
  'trigger',
  'rls',
];

/**
 * Objects that exist in every fresh Postgres database, or that the local
 * Supabase stand-in creates. A migration never "owns" these, and production
 * has them for reasons unrelated to any migration.
 */
const ALWAYS_PRESENT = new Set(['schema|public']);

export class PsqlError extends Error {}

/** Run one query and return trimmed, non-empty lines. */
export function psqlLines(url, sql, { timeoutMs = 120_000 } = {}) {
  const out = spawnSync(
    'psql',
    [url, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-A', '-t', '-F', '|', '-c', sql],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
  );
  if (out.error) throw new PsqlError(`psql could not run: ${out.error.message}`);
  if (out.status !== 0) {
    throw new PsqlError((out.stderr || out.stdout || 'psql failed').trim());
  }
  return out.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The set of `kind|identifier` strings a database currently contains. */
export function snapshot(url) {
  const set = new Set();
  for (const line of psqlLines(url, INTROSPECT_SQL)) {
    if (!ALWAYS_PRESENT.has(line)) set.add(line);
  }
  return set;
}

/** Split a `kind|identifier` string. */
export function parseObject(entry) {
  const i = entry.indexOf('|');
  return { kind: entry.slice(0, i), id: entry.slice(i + 1) };
}

/** Group entries by kind, for a readable report. */
export function groupByKind(entries) {
  const byKind = new Map();
  for (const e of entries) {
    const { kind, id } = parseObject(e);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(id);
  }
  for (const list of byKind.values()) list.sort();
  return byKind;
}

/**
 * Objects whose presence is implied by another object in the same set.
 *
 * A column cannot exist without its table, and an index or policy or trigger
 * cannot exist without the table it is on. When a whole table is missing, the
 * report should say "table X is missing" once rather than list its 40 columns,
 * its indexes and its policies as separate findings.
 */
export function collapseImplied(missing) {
  const missingTables = new Set();
  for (const e of missing) {
    const { kind, id } = parseObject(e);
    if (kind === 'table' || kind === 'view' || kind === 'matview') missingTables.add(id);
  }
  if (missingTables.size === 0) return missing;

  return missing.filter((e) => {
    const { kind, id } = parseObject(e);
    if (kind === 'column' || kind === 'policy' || kind === 'trigger' || kind === 'index') {
      // schema.table.thing → schema.table
      const parent = id.slice(0, id.lastIndexOf('.'));
      return !missingTables.has(parent);
    }
    if (kind === 'rls') return !missingTables.has(id);
    return true;
  });
}

/**
 * The table an object belongs to, as `schema.table`, or null when it belongs to
 * no table (a function, a type, a schema, a standalone view).
 *
 * Used to decide overlap: an implicit primary-key index is named in no
 * migration, so the only way to know two migrations could both have produced it
 * is to ask which table it hangs off.
 */
export function owningTable(entry) {
  const { kind, id } = parseObject(entry);
  if (kind === 'column' || kind === 'policy' || kind === 'trigger' || kind === 'index') {
    return id.slice(0, id.lastIndexOf('.'));
  }
  if (kind === 'rls' || kind === 'table') return id;
  return null;
}
