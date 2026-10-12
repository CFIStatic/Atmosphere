import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Self-serve product demos with the founder, booked from atmosphereteam.com/demo.
 *
 * Slots: 30 minutes, weekdays, 9:00 AM–5:00 PM America/Chicago, for the next
 * DEMO_WINDOW_DAYS days. A slot must start at least DEMO_MIN_LEAD_MS from now.
 * The table's unique index on slot_start (status = 'booked') is what stops a
 * double booking; the slot list just hides taken ones.
 */
export const DEMO_TIME_ZONE = 'America/Chicago';
export const DEMO_SLOT_MINUTES = 30;
export const DEMO_DAY_START_HOUR = 9;
export const DEMO_DAY_END_HOUR = 17;
export const DEMO_WINDOW_DAYS = 21;
export const DEMO_MIN_LEAD_MS = 2 * 60 * 60 * 1000;

const chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: DEMO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

type WallClock = { y: number; m: number; d: number; h: number; min: number; weekday: string };

export function chicagoWallClock(at: Date): WallClock {
  const parts: Record<string, string> = {};
  for (const p of chicagoParts.formatToParts(at)) parts[p.type] = p.value;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    weekday: parts.weekday ?? '',
  };
}

/** UTC instant of a Chicago wall-clock time (handles CST/CDT). */
export function chicagoToUtc(y: number, m: number, d: number, h: number, min: number): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target + 6 * 60 * 60 * 1000;
  for (let i = 0; i < 3; i += 1) {
    const w = chicagoWallClock(new Date(guess));
    const seen = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
    if (seen === target) break;
    guess += target - seen;
  }
  return new Date(guess);
}

/** Every bookable slot start (UTC ISO) from now through the window. */
export function demoSlotStarts(now: Date = new Date()): string[] {
  const out: string[] = [];
  const today = chicagoWallClock(now);
  const earliest = now.getTime() + DEMO_MIN_LEAD_MS;
  for (let offset = 0; offset <= DEMO_WINDOW_DAYS; offset += 1) {
    // Noon on the calendar day keeps the date stable across DST.
    const noon = new Date(Date.UTC(today.y, today.m - 1, today.d + offset, 12));
    const y = noon.getUTCFullYear();
    const m = noon.getUTCMonth() + 1;
    const d = noon.getUTCDate();
    const weekday = chicagoWallClock(chicagoToUtc(y, m, d, 12, 0)).weekday;
    if (weekday === 'Sat' || weekday === 'Sun') continue;
    for (let minutes = DEMO_DAY_START_HOUR * 60; minutes < DEMO_DAY_END_HOUR * 60; minutes += DEMO_SLOT_MINUTES) {
      const start = chicagoToUtc(y, m, d, Math.floor(minutes / 60), minutes % 60);
      if (start.getTime() >= earliest) out.push(start.toISOString());
    }
  }
  return out;
}

export function isBookableSlot(iso: string, now: Date = new Date()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const canonical = new Date(t).toISOString();
  return demoSlotStarts(now).includes(canonical);
}

export const demoBookingSchema = z.object({
  slotStart: z.string({ required_error: 'Pick a time' }).trim().min(1, 'Pick a time').max(40),
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(200),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(320),
  company: z.string({ required_error: 'Company is required' }).trim().min(1, 'Company is required').max(200),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+().\-\s]*$/, 'Enter a valid phone number')
    .optional()
    .default(''),
  notes: z.string().trim().max(2000).optional().default(''),
  timeZone: z.string().trim().max(64).optional().default(''),
  website: z.string().max(200).optional().default(''),
});

export type DemoBookingInput = z.infer<typeof demoBookingSchema>;

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 folding: lines over 75 octets continue with a leading space. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildDemoIcs(input: {
  uid?: string;
  start: Date;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
  company: string;
  phone?: string;
  notes?: string;
  now?: Date;
}): string {
  const end = new Date(input.start.getTime() + DEMO_SLOT_MINUTES * 60 * 1000);
  const description = [
    `Atmosphere product demo with ${input.organizerName}.`,
    `Guest: ${input.attendeeName} (${input.company}), ${input.attendeeEmail}`,
    input.phone ? `Phone: ${input.phone}` : '',
    input.notes ? `Notes: ${input.notes}` : '',
    `Need to change the time? Reply to the confirmation email.`,
  ]
    .filter(Boolean)
    .join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Atmosphere//Demo booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${input.uid ?? randomUUID()}@atmosphereteam.com`,
    `DTSTAMP:${icsStamp(input.now ?? new Date())}`,
    `DTSTART:${icsStamp(input.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(`Atmosphere demo — ${input.attendeeName} (${input.company})`)}`,
    `DESCRIPTION:${icsText(description)}`,
    `ORGANIZER;CN=${icsText(input.organizerName)}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CN=${icsText(input.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${input.attendeeEmail}`,
    `ATTENDEE;CN=${icsText(input.organizerName)};ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:${input.organizerEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Atmosphere demo in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** "Tue, Oct 13, 2:30 PM CT" in Chicago, or in the visitor's zone when valid. */
export function formatSlot(start: Date, timeZone: string = DEMO_TIME_ZONE): string {
  let zone = DEMO_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    zone = timeZone || DEMO_TIME_ZONE;
  } catch {
    zone = DEMO_TIME_ZONE;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(start);
}
