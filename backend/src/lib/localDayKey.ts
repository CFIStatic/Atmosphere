/**
 * The org's local calendar day for an instant, as `YYYY-MM-DD`.
 *
 * "Has anyone taken a reading today?" (and similar field checks) are meaningless
 * in UTC: a 9pm Eastern reading is tomorrow in UTC, so a UTC-based check would
 * report a missed day on a job that was visited that evening.
 */
export function localDayKey(instant: Date, timezone: string): string {
  try {
    // en-CA gives ISO-ordered parts, which is what makes this sortable.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    // An invalid IANA zone should degrade to something usable rather than throw.
    return instant.toISOString().slice(0, 10);
  }
}
