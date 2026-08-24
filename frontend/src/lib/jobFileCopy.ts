/** Default name for a duplicated job file. Keep in step with the backend helper. */
export function suggestedDuplicateTitle(title: string): string {
  const base = title.trim() || 'Job';
  const prefix = 'Copy of ';
  if (base.toLowerCase().startsWith(prefix.toLowerCase())) {
    return base.slice(0, 200);
  }
  return `${prefix}${base}`.slice(0, 200);
}
