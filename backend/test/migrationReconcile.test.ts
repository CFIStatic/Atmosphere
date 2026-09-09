import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The reconciler decides whether production is safe to baseline. Its whole
 * judgement is a pure function of the committed manifest and a set of object
 * identifiers, so it is tested here without a database.
 *
 * The rule that matters: a migration is only ever called "missing" on the
 * strength of an object it creates and no other migration does. Everything
 * else is reported as not checkable. A wrong "applied" tells the operator to
 * baseline a migration that never ran, and the ledger then hides it forever.
 */

const scripts = new URL('../scripts/lib/', import.meta.url);
const {
  classify,
  summarize,
  safeBaselineVersions,
  isClean,
} = await import(new URL('reconcile.mjs', scripts).href);
const { collapseImplied, owningTable } = await import(new URL('schemaIntrospect.mjs', scripts).href);

const manifest = JSON.parse(
  readFileSync(new URL('../../supabase/migration-manifest.json', import.meta.url), 'utf8'),
);
const migrationDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

/* ------------------------------------------------------------- manifest -- */

test('manifest covers every migration file exactly once', () => {
  const onDisk = readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort();
  const inManifest = manifest.migrations.map((m: { file: string }) => m.file).sort();
  assert.deepEqual(inManifest, onDisk);
});

test('a verifiable migration always has at least one exclusive object', () => {
  for (const m of manifest.migrations) {
    if (m.structurallyVerifiable) {
      assert.ok(
        Array.isArray(m.expect) && m.expect.length > 0,
        `${m.file} is marked verifiable but expects nothing`,
      );
    } else {
      assert.equal(m.expect.length, 0, `${m.file} is unverifiable but still expects objects`);
      assert.ok(m.indistinguishableReason, `${m.file} is unverifiable with no reason given`);
    }
  }
});

test('every expected object is a kind|identifier pair', () => {
  const kinds = new Set([
    'schema', 'table', 'view', 'matview', 'column',
    'type', 'function', 'index', 'policy', 'trigger', 'rls',
  ]);
  for (const m of manifest.migrations) {
    for (const o of m.expect) {
      const [kind, id] = [o.slice(0, o.indexOf('|')), o.slice(o.indexOf('|') + 1)];
      assert.ok(kinds.has(kind), `${m.file}: unknown object kind ${kind}`);
      // A schema's identifier is the schema name itself; everything else is
      // qualified by the schema it lives in.
      if (kind !== 'schema') {
        assert.ok(id.includes('.'), `${m.file}: ${o} is not schema-qualified`);
      }
    }
  }
});

test('no object is expected by two different migrations', () => {
  // Exclusivity is the property the whole report rests on. If two migrations
  // both claim an object, neither one's absence proves anything.
  const owner = new Map<string, string>();
  for (const m of manifest.migrations) {
    for (const o of m.expect) {
      assert.equal(owner.get(o), undefined, `${o} is claimed by ${owner.get(o)} and ${m.file}`);
      owner.set(o, m.file);
    }
  }
});

/* ------------------------------------------------------------- classify -- */

const fixture = {
  migrations: [
    { version: 'a', file: 'a.sql', structurallyVerifiable: true, expect: ['table|public.a', 'index|public.a.a_pkey'] },
    { version: 'b', file: 'b.sql', structurallyVerifiable: true, expect: ['table|public.b'] },
    { version: 'c', file: 'c.sql', structurallyVerifiable: true, expect: ['table|public.c', 'column|public.c.x'] },
    { version: 'd', file: 'd.sql', structurallyVerifiable: false, expect: [], indistinguishableReason: 'grants only' },
  ],
};

test('classifies applied, missing, partial and unverifiable', () => {
  const live = new Set(['table|public.a', 'index|public.a.a_pkey', 'table|public.c']);
  const results = classify(fixture, live);
  const status = Object.fromEntries(results.map((r: any) => [r.version, r.status]));
  assert.equal(status.a, 'applied');
  assert.equal(status.b, 'missing');
  assert.equal(status.c, 'partial');
  assert.equal(status.d, 'unverifiable');
  assert.deepEqual(summarize(results), {
    total: 4, applied: 1, partial: 1, missing: 1, unverifiable: 1,
  });
});

test('a migration expecting nothing is never called missing', () => {
  // Empty expectations against an empty database must still be unverifiable,
  // not "missing" — this is the false report that would send someone re-running
  // a data backfill against production.
  const results = classify(fixture, new Set());
  const d = results.find((r: any) => r.version === 'd');
  assert.equal(d.status, 'unverifiable');
});

test('a verifiable migration with an emptied expect list is not called missing', () => {
  const odd = { migrations: [{ version: 'x', file: 'x.sql', structurallyVerifiable: true, expect: [] }] };
  assert.equal(classify(odd, new Set())[0].status, 'unverifiable');
});

test('the baseline list omits anything missing or partial', () => {
  const live = new Set(['table|public.a', 'index|public.a.a_pkey', 'table|public.c']);
  const results = classify(fixture, live);
  assert.deepEqual(safeBaselineVersions(results), ['a', 'd']);
  assert.equal(isClean(results), false);
});

test('a fully applied database is clean and baselines everything', () => {
  const live = new Set(['table|public.a', 'index|public.a.a_pkey', 'table|public.b', 'table|public.c', 'column|public.c.x']);
  const results = classify(fixture, live);
  assert.equal(isClean(results), true);
  assert.deepEqual(safeBaselineVersions(results), ['a', 'b', 'c', 'd']);
});

/* ---------------------------------------------------------- introspect --- */

test('owningTable finds the table an object hangs off', () => {
  assert.equal(owningTable('index|public.jobs.jobs_pkey'), 'public.jobs');
  assert.equal(owningTable('policy|public.jobs.jobs_read'), 'public.jobs');
  assert.equal(owningTable('column|public.jobs.id'), 'public.jobs');
  assert.equal(owningTable('rls|public.jobs'), 'public.jobs');
  assert.equal(owningTable('table|public.jobs'), 'public.jobs');
  assert.equal(owningTable('function|public.do_thing'), null);
  assert.equal(owningTable('type|public.status'), null);
});

test('a missing table collapses its children into one finding', () => {
  const missing = [
    'table|public.jobs',
    'column|public.jobs.id',
    'index|public.jobs.jobs_pkey',
    'policy|public.jobs.jobs_read',
    'rls|public.jobs',
    'table|public.other',
    'column|public.kept.id',
  ];
  assert.deepEqual(collapseImplied(missing), [
    'table|public.jobs',
    'table|public.other',
    'column|public.kept.id',
  ]);
});

/* -------------------------------------------------------- apply order --- */

test('the manifest records migrations that cannot run in filename order', () => {
  // The runner applies in filename order. One migration alters a table a
  // later-named migration creates, so a database cannot be built from these
  // files as they stand. Recorded rather than silently reordered.
  assert.ok(Array.isArray(manifest.outOfOrder));
  for (const o of manifest.outOfOrder) {
    assert.ok(o.file.endsWith('.sql'));
    assert.ok(o.firstError.length > 0);
  }
});
