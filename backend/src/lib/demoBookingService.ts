import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
import {
  DEMO_WINDOW_DAYS,
  buildDemoIcs,
  demoSlotStarts,
  isBookableSlot,
  type DemoBookingInput,
} from './demoBooking.js';
import { DEFAULT_DEMO_MEET, demoGuestEmail, demoHostEmail, type DemoMeet } from './demoBookingEmail.js';
import { DEMO_SLOT_MINUTES } from './demoBooking.js';
import { createGoogleCalendarClient, type GoogleCalendarClient } from './googleCalendar.js';
import type { MailAttachment } from './systemMail.js';

export const DEMO_ORGANIZER_EMAIL = (process.env.DEMO_BOOKING_TO_EMAIL || 'jack@jettx.ai').trim();
export const DEMO_ORGANIZER_NAME = (process.env.DEMO_BOOKING_HOST_NAME || 'Jack Cyganiak').trim();

export type DemoBookingStore = {
  /** Booked slot starts (ISO) between from and to. */
  bookedBetween(fromIso: string, toIso: string): Promise<string[]>;
  /** Insert; resolves 'taken' when the slot's unique index rejects it. */
  insert(row: Record<string, unknown>): Promise<{ id: string } | 'taken'>;
  markEmailed(id: string, field: 'host_emailed_at' | 'guest_emailed_at'): Promise<void>;
  /** Record the Google Calendar event made for a booking. */
  markCalendarEvent?(id: string, eventId: string, meetUrl: string): Promise<void>;
};

let defaultCalendar: GoogleCalendarClient | null | undefined;
/** The host's Google Calendar, or null when no credentials are configured (feature off). */
export function demoCalendar(): GoogleCalendarClient | null {
  if (defaultCalendar === undefined) {
    defaultCalendar = createGoogleCalendarClient({ hostEmail: DEMO_ORGANIZER_EMAIL });
    if (defaultCalendar) console.log('[demo] Google Calendar invites on');
  }
  return defaultCalendar;
}

const BUSY_TTL_MS = 60_000;
let busyCache: { at: number; key: string; busy: Array<{ start: number; end: number }> } | null = null;
export function resetDemoBusyCacheForTests(): void {
  busyCache = null;
}

export type DemoMailer = (input: {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  keepReplyTo?: boolean;
  attachments?: MailAttachment[];
}) => Promise<{ ok: true } | { ok: false; why: string }>;

export function supabaseDemoStore(client: SupabaseClient): DemoBookingStore {
  return {
    async bookedBetween(fromIso, toIso) {
      const { data, error } = await client
        .from('demo_bookings')
        .select('slot_start')
        .eq('status', 'booked')
        .gte('slot_start', fromIso)
        .lte('slot_start', toIso);
      if (error) throw new Error(`demo_bookings read failed: ${error.message}`);
      return (data ?? []).map((r) => new Date(String(r.slot_start)).toISOString());
    },
    async insert(row) {
      const { data, error } = await client.from('demo_bookings').insert(row).select('id').single();
      if (error) {
        if (error.code === '23505') return 'taken';
        throw new Error(`demo_bookings insert failed: ${error.message}`);
      }
      return { id: String(data.id) };
    },
    async markEmailed(id, field) {
      await client.from('demo_bookings').update({ [field]: new Date().toISOString() }).eq('id', id);
    },
    async markCalendarEvent(id, eventId, meetUrl) {
      const { error } = await client
        .from('demo_bookings')
        .update({ google_event_id: eventId, meet_url: meetUrl })
        .eq('id', id);
      if (error) console.error('[demo] could not store calendar event:', error.message);
    },
  };
}

export async function openDemoSlots(
  store: DemoBookingStore,
  now: Date = new Date(),
  calendar: GoogleCalendarClient | null = demoCalendar(),
): Promise<string[]> {
  const all = demoSlotStarts(now);
  if (all.length === 0) return [];
  const taken = new Set(await store.bookedBetween(all[0]!, all[all.length - 1]!));
  const open = all.filter((s) => !taken.has(s));
  if (!calendar) return open;
  // Hide hours the host is busy. Fails open: a Google hiccup must not empty the picker.
  const slotMs = DEMO_SLOT_MINUTES * 60_000;
  const from = new Date(Date.parse(all[0]!));
  const to = new Date(Date.parse(all[all.length - 1]!) + slotMs);
  const key = `${from.toISOString()}|${to.toISOString()}`;
  let busy: Array<{ start: number; end: number }>;
  if (busyCache && busyCache.key === key && now.getTime() - busyCache.at < BUSY_TTL_MS) {
    busy = busyCache.busy;
  } else {
    try {
      busy = await calendar.busy(from, to);
      busyCache = { at: now.getTime(), key, busy };
    } catch (err) {
      console.error('[demo] freebusy failed; showing all open slots:', err instanceof Error ? err.message : err);
      return open;
    }
  }
  return open.filter((s) => {
    const a = Date.parse(s);
    const b = a + slotMs;
    return !busy.some((x) => x.start < b && x.end > a);
  });
}

export function demoEventDescription(input: DemoBookingInput): string {
  return [
    `A ${DEMO_SLOT_MINUTES}-minute live walkthrough of Atmosphere with ${DEMO_ORGANIZER_NAME}, Founder.`,
    '',
    'We will cover how Atmosphere fits your team, walk through the product, and answer your questions.',
    '',
    `Booked by: ${input.name}, ${input.company}`,
    `Email: ${input.email}`,
    ...(input.phone ? [`Phone: ${input.phone}`] : []),
    ...(input.notes ? ['', `Notes: ${input.notes}`] : []),
    '',
    `Need to reschedule? Reply to the confirmation email or write to ${DEMO_ORGANIZER_EMAIL}.`,
    'https://atmosphereteam.com',
  ].join('\n');
}

/**
 * Book a slot, then email the host and the guest an invite. The row is the
 * source of truth: once it is in, the slot is held even if mail fails.
 */
export async function bookDemo(
  input: DemoBookingInput,
  deps: {
    store: DemoBookingStore;
    send: DemoMailer;
    ip: string | null;
    now?: Date;
    calendar?: GoogleCalendarClient | null;
  },
): Promise<{
  id: string;
  slotStart: string;
  hostEmailed: boolean;
  guestEmailed: boolean;
  calendarEvent: boolean;
}> {
  const now = deps.now ?? new Date();
  if (!isBookableSlot(input.slotStart, now)) {
    throw new HttpError(409, 'That time is no longer available. Pick another.', 'slot_unavailable');
  }
  const start = new Date(Date.parse(input.slotStart));
  const slotStart = start.toISOString();
  const inserted = await deps.store.insert({
    slot_start: slotStart,
    name: input.name,
    email: input.email,
    company: input.company,
    phone: input.phone || null,
    notes: input.notes || null,
    guest_time_zone: input.timeZone || null,
    client_ip: deps.ip,
    status: 'booked',
  });
  if (inserted === 'taken') {
    throw new HttpError(409, 'Someone just booked that time. Pick another.', 'slot_taken');
  }

  // A real Google Calendar event with its own Meet room, when configured.
  // Any failure falls back to the reusable room and the .ics attachment.
  const calendar = deps.calendar === undefined ? demoCalendar() : deps.calendar;
  let meet: DemoMeet = DEFAULT_DEMO_MEET;
  if (calendar) {
    try {
      const ev = await calendar.createDemoEvent({
        requestId: inserted.id,
        start,
        end: new Date(start.getTime() + DEMO_SLOT_MINUTES * 60_000),
        summary: `Atmosphere product demo: ${input.company}`,
        description: demoEventDescription(input),
        attendee: { email: input.email, name: input.name },
      });
      meet = { url: ev.meetUrl, dialIn: ev.dialIn, pin: ev.pin, calendarInvite: 'google' };
      await deps.store.markCalendarEvent?.(inserted.id, ev.eventId, ev.meetUrl).catch(() => undefined);
    } catch (err) {
      console.error('[demo] google calendar event failed; falling back to .ics:', err instanceof Error ? err.message : err);
    }
  }

  const ics = buildDemoIcs({
    uid: inserted.id,
    start,
    organizerEmail: DEMO_ORGANIZER_EMAIL,
    organizerName: DEMO_ORGANIZER_NAME,
    attendeeEmail: input.email,
    attendeeName: input.name,
    company: input.company,
    phone: input.phone,
    notes: input.notes,
    now,
  });
  const attachments: MailAttachment[] = meet.calendarInvite === 'google' ? [] : [
    { filename: 'atmosphere-demo.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' },
  ];

  const host = await deps.send({
    to: DEMO_ORGANIZER_EMAIL,
    ...demoHostEmail(input, start, meet),
    replyTo: `"${input.name.replaceAll('"', "'")}" <${input.email}>`,
    keepReplyTo: true,
    ...(attachments.length ? { attachments } : {}),
  });
  if (host.ok) await deps.store.markEmailed(inserted.id, 'host_emailed_at').catch(() => undefined);
  else console.error('[demo] host email failed:', host.why);

  const guest = await deps.send({
    to: input.email,
    ...demoGuestEmail(input, start, DEMO_ORGANIZER_NAME, meet),
    replyTo: DEMO_ORGANIZER_EMAIL,
    keepReplyTo: true,
    ...(attachments.length ? { attachments } : {}),
  });
  if (guest.ok) await deps.store.markEmailed(inserted.id, 'guest_emailed_at').catch(() => undefined);
  else console.error('[demo] guest email failed:', guest.why);

  return {
    id: inserted.id,
    slotStart,
    hostEmailed: host.ok,
    guestEmailed: guest.ok,
    calendarEvent: meet.calendarInvite === 'google',
  };
}

export { DEMO_WINDOW_DAYS };
