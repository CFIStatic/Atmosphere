/**
 * Type-to-confirm for a permanent job-file delete. Keep in step with
 * the backend helper — the name on the dashboard is what they must type.
 */
export function jobFileDeleteNameMatches(fileName: string, typed: string): boolean {
  const expected = fileName.trim();
  return expected.length > 0 && expected === typed.trim();
}

/** Default name for a duplicated job file. Keep in step with the backend helper. */
export function suggestedDuplicateTitle(title: string): string {
  const base = title.trim() || 'Job';
  const prefix = 'Copy of ';
  if (base.toLowerCase().startsWith(prefix.toLowerCase())) {
    return base.slice(0, 200);
  }
  return `${prefix}${base}`.slice(0, 200);
}
