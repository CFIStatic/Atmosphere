/**
 * One way to turn an instant into a calendar day: the job's / org's local day.
 *
 * Every "which day was this?" question in the product (integrity checks, the
 * timeline, today's jobs, the daily digest, clip labels) must go through here.
 * A 7pm Central clip is tomorrow in UTC, and a UTC day key turns an ordinary
 * evening walk-through into a false "filmed on the wrong day" flag.
 */

/** Used only when nothing better is known (no org zone stored). */
export const DEFAULT_TIME_ZONE = 'America/New_York';

/** A valid IANA zone, or null. */
export function safeTimeZone(zone: string | null | undefined): string | null {
  const z = String(zone ?? '').trim();
  if (!z || z.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return null;
  }
}

/** First valid zone among the candidates, else DEFAULT_TIME_ZONE. */
export function resolveTimeZone(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const z = safeTimeZone(c);
    if (z) return z;
  }
  return DEFAULT_TIME_ZONE;
}

/** The local calendar day for an instant, as `YYYY-MM-DD`. */
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
    return localDayKey(instant, DEFAULT_TIME_ZONE);
  }
}

/**
 * Local day of an ISO timestamp. A bare `YYYY-MM-DD` is already a local day
 * and is returned unchanged (never shifted through UTC).
 */
export function localDateOf(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const at = Date.parse(s);
  if (!Number.isFinite(at)) return null;
  return localDayKey(new Date(at), timezone);
}

/** Today in the given zone. */
export function localToday(timezone: string, now: Date = new Date()): string {
  return localDayKey(now, timezone);
}

/** Whole days from day `a` to day `b` (both YYYY-MM-DD). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Hour of day (0-23) of an instant in the zone. */
export function localHour(instant: Date, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(instant);
  return Number(h) % 24;
}

/** The org's timezone, from its stored setting. Never throws. */
type OrgZoneReader = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
    };
  };
};

export async function orgTimeZone(admin: unknown, orgId: string | null | undefined): Promise<string> {
  if (!orgId) return DEFAULT_TIME_ZONE;
  try {
    const { data } = await (admin as OrgZoneReader)
      .from('orgs')
      .select('daily_job_report_timezone')
      .eq('id', orgId)
      .maybeSingle();
    return resolveTimeZone((data as { daily_job_report_timezone?: string | null } | null)?.daily_job_report_timezone);
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
