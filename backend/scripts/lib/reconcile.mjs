/**
 * Decide, for each migration in the manifest, whether the live schema shows it
 * was applied.
 *
 * Kept separate from the CLI so it can be tested without a database: the whole
 * judgement is a pure function of the manifest and a set of object identifiers.
 */

export const APPLIED = 'applied';
export const MISSING = 'missing';
export const PARTIAL = 'partial';
export const UNVERIFIABLE = 'unverifiable';

/**
 * @param manifest  parsed supabase/migration-manifest.json
 * @param live      Set of `kind|identifier` strings from schemaIntrospect.snapshot()
 */
export function classify(manifest, live) {
  return manifest.migrations.map((m) => {
    // `expect` holds only objects this migration creates and no other does.
    // When it is empty the migration leaves no trace we can attribute to it,
    // and no amount of introspection distinguishes "ran" from "did not run".
    if (!m.structurallyVerifiable || !m.expect || m.expect.length === 0) {
      return {
        ...m,
        status: UNVERIFIABLE,
        present: [],
        absent: [],
      };
    }

    const present = m.expect.filter((o) => live.has(o));
    const absent = m.expect.filter((o) => !live.has(o));

    let status = APPLIED;
    if (present.length === 0) status = MISSING;
    else if (absent.length > 0) status = PARTIAL;

    return { ...m, status, present, absent };
  });
}

export function summarize(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    total: results.length,
    applied: count(APPLIED),
    partial: count(PARTIAL),
    missing: count(MISSING),
    unverifiable: count(UNVERIFIABLE),
  };
}

/**
 * The versions it is safe to record as already applied.
 *
 * Anything that looks missing or partial is left out, so the runner applies it
 * on the next deploy instead of the baseline burying it. Unverifiable
 * migrations ARE included: we cannot show they ran, but we also cannot show
 * they did not, and re-running a grant or a data backfill against a live
 * database is the more dangerous of the two mistakes.
 */
export function safeBaselineVersions(results) {
  return results
    .filter((r) => r.status !== MISSING && r.status !== PARTIAL)
    .map((r) => r.version);
}

/** True when nothing needs a human decision before baselining. */
export function isClean(results) {
  return !results.some((r) => r.status === MISSING || r.status === PARTIAL);
}
