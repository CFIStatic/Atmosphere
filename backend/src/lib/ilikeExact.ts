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
