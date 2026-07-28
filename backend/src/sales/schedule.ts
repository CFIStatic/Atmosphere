/**
 * Autonomous meeting scheduling from campaign availability windows.
 */

export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

const WEEKDAY: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type Availability = Partial<Record<WeekdayKey, string[]>>;

const DEFAULT_AVAILABILITY: Availability = {
  mon: ['09:00-12:00', '13:00-17:00'],
  tue: ['09:00-12:00', '13:00-17:00'],
  wed: ['09:00-12:00', '13:00-17:00'],
  thu: ['09:00-12:00', '13:00-17:00'],
  fri: ['09:00-12:00', '13:00-16:00'],
};

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function atLocal(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/**
 * Pick the next open slot starting from `after`, skipping already-booked starts.
 */
export function pickMeetingSlot(input: {
  availability?: Availability | null;
  durationMin: number;
  after?: Date;
  busyStarts?: Date[];
  searchDays?: number;
}): { startsAt: Date; endsAt: Date } | null {
  const availability =
    input.availability && Object.keys(input.availability).length > 0
      ? input.availability
      : DEFAULT_AVAILABILITY;
  const duration = input.durationMin || 30;
  const busy = new Set((input.busyStarts ?? []).map((d) => d.toISOString()));
  const startDay = new Date(input.after ?? Date.now());
  // Begin searching tomorrow morning so we never book "in 10 minutes".
  startDay.setDate(startDay.getDate() + 1);
  startDay.setHours(0, 0, 0, 0);

  const days = input.searchDays ?? 21;
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(startDay);
    day.setDate(startDay.getDate() + offset);
    const key = WEEKDAY[day.getDay()];
    const windows = availability[key] ?? [];
    for (const window of windows) {
      const [from, to] = window.split('-');
      if (!from || !to) continue;
      let cursor = parseHm(from);
      const end = parseHm(to);
      while (cursor + duration <= end) {
        const startsAt = atLocal(day, cursor);
        const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        if (!busy.has(startsAt.toISOString()) && startsAt.getTime() > Date.now() + 60 * 60_000) {
          return { startsAt, endsAt };
        }
        cursor += 30; // 30-minute grid
      }
    }
  }
  return null;
}

export function buildIcs(input: {
  title: string;
  description: string;
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
  organizerEmail: string;
  attendeeEmail: string;
}): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

  const uid = `sales-${stamp(input.startsAt)}-${Math.random().toString(36).slice(2, 10)}@atmosphere`;
  const desc = input.description.replace(/\n/g, '\\n');
  const loc = (input.location || 'In person').replace(/\n/g, ' ');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Atmosphere//Sales Agent//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.startsAt)}`,
    `DTEND:${stamp(input.endsAt)}`,
    `SUMMARY:${input.title}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${loc}`,
    `ORGANIZER:mailto:${input.organizerEmail}`,
    `ATTENDEE:mailto:${input.attendeeEmail}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function formatSlot(startsAt: Date, endsAt: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return `${startsAt.toLocaleString(undefined, opts)} – ${endsAt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}
