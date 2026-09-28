/**
 * One formatter for "when did this happen" on the job file.
 *
 * Every label is read from the same instant, in the viewer's timezone. Never
 * slice an ISO string for its calendar day (`iso.slice(0, 10)` is the UTC day)
 * and then pair it with a local clock — late evening in the Americas is
 * already tomorrow in UTC, so the two halves disagree by a day.
 */

let zoneOverride: string | null = null;

/** Tests pin a zone so CI (UTC) and a Chicago laptop print the same thing. */
export function setViewerTimeZoneForTests(zone: string | null): void {
  zoneOverride = zone;
}

export function viewerTimeZone(): string {
  if (zoneOverride) return zoneOverride;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toInstant(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function zonePart(date: Date, timeZone: string, style: 'short' | 'shortGeneric'): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: style })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

/**
 * Short zone label for the viewer: "CT" in Chicago, "PT" in Los Angeles.
 * Zones without a short US-style name fall back to "UTC" / "GMT+2".
 */
function zoneLabel(date: Date, timeZone: string): string {
  const generic = zonePart(date, timeZone, 'shortGeneric');
  if (/^[A-Z]{2,4}$/.test(generic) && generic !== 'GMT') return generic;
  return zonePart(date, timeZone, 'short');
}

/** "11:30 PM CT" */
export function formatViewerTime(iso: string | null | undefined, timeZone = viewerTimeZone()): string {
  const date = toInstant(iso);
  if (!date) return '';
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const zone = zoneLabel(date, timeZone);
  return zone ? `${clock} ${zone}` : clock;
}

/** "Sunday, September 27, 2026" */
export function formatViewerDay(iso: string | null | undefined, timeZone = viewerTimeZone()): string {
  const date = toInstant(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** "2026-09-27" — the viewer's calendar day for grouping. */
export function viewerDayKey(iso: string | null | undefined, timeZone = viewerTimeZone()): string {
  const date = toInstant(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
