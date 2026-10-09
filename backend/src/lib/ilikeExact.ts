/**
 * A PostgREST `ilike` pattern that matches `value` exactly, ignoring case.
 *
 * Plain `.ilike('email', email)` treats `_` as "any one character" (and `%`
 * and PostgREST's `*` as "anything"), so `john_doe@x.com` would also match
 * `johnxdoe@x.com`. Backslash-escape LIKE's metacharacters. PostgREST turns
 * every `*` into `%` before Postgres sees it, so a value containing `*` can't
 * be matched exactly: null tells the caller to treat it as no match.
 */
export function ilikeExact(value: string): string | null {
  if (value.includes('*')) return null;
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * A PostgREST `ilike` pattern for "contains this text", with the person's own
 * % _ \ escaped so they match literally. PostgREST also reads `*` as a
 * wildcard, and a comma or paren would break an `or=` filter, so those
 * characters become a single-character wildcard. Null for an empty search.
 */
export function ilikeContains(value: string): string | null {
  const v = value.replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!v) return null;
  return `%${v.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[*,()]/g, '_')}%`;
}
