import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
import {
  DEMO_SLOT_MINUTES,
  DEMO_WINDOW_DAYS,
  buildDemoIcs,
  demoSlotStarts,
  isBookableSlot,
  type DemoBookingInput,
} from './demoBooking.js';
import { demoGuestEmail, demoHostEmail } from './demoBookingEmail.js';
import type { MailAttachment } from './systemMail.js';
import type { GoogleCalendarClient } from './googleCalendar.js';

export const DEMO_ORGANIZER_EMAIL = (process.env.DEMO_BOOKING_TO_EMAIL || 'jack@jettx.ai').trim();
export const DEMO_ORGANIZER_NAME = (process.env.DEMO_BOOKING_HOST_NAME || 'Jack Cyganiak').trim();

/** Once-only markers on demo_bookings, each claimed atomically before its email. */
export type DemoOnceField = 'host_notified_at' | 'guest_emailed_at';

export type DemoBookingStore = {
  /** Booked slot starts (ISO) between from and to. */
  bookedBetween(fromIso: string, toIso: string): Promise<string[]>;
  /** Insert; resolves 'taken' when the slot's unique index rejects it. */
  insert(row: Record<string, unknown>): Promise<{ id: string } | 'taken'>;
  /** The booking, or null. */
  get(id: string): Promise<DemoBookingRow | null>;
  /**
   * Store the booking's calendar event + Meet link only if it has none yet.
   * Resolves the event id the row ends up with (ours, or one already there).
   */
  setMeetOnce(id: string, meetUrl: string, eventId: string): Promise<{ eventId: string; meetUrl: string }>;
  /** Atomically set the field if still null; false if already set. */
  claim(id: string, field: DemoOnceField): Promise<boolean>;
  release(id: string, field: DemoOnceField): Promise<void>;
};

export type DemoBookingRow = {
  id: string;
  slot_start: string;
  status: string;
  name: string;
  email: string;
  company: string;
  phone: string | null;
  notes: string | null;
  guest_time_zone: string | null;
  host_notified_at: string | null;
  guest_emailed_at: string | null;
  google_event_id: string | null;
  meet_url: string | null;
};

function rowInput(row: DemoBookingRow): DemoBookingInput {
  return {
    slotStart: new Date(row.slot_start).toISOString(),
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone ?? '',
    notes: row.notes ?? '',
    timeZone: row.guest_time_zone ?? '',
    website: '',
  } as DemoBookingInput;
}

type MeetEvent = { eventId: string; meetUrl: string; iCalUID?: string | null };

/**
 * The guest's one email (Meet link + .ics) and the host's one email, each sent at
 * most once (guest_emailed_at / host_notified_at are claimed first, released if
 * the send fails). Never throws on mail failure.
 */
async function sendBookingEmails(
  row: DemoBookingRow,
  event: MeetEvent,
  deps: { store: DemoBookingStore; send: DemoMailer; now?: Date },
): Promise<{ guest: 'sent' | 'failed' | 'already_sent'; host: 'sent' | 'failed' | 'already_sent' }> {
  const b = rowInput(row);
  const start = new Date(row.slot_start);
  let guest: 'sent' | 'failed' | 'already_sent' = 'already_sent';
  if (!row.guest_emailed_at && (await deps.store.claim(row.id, 'guest_emailed_at'))) {
    guest = (await trySend(deps.send, {
      to: row.email,
      ...demoGuestEmail(b, start, DEMO_ORGANIZER_NAME, event.meetUrl),
      replyTo: DEMO_ORGANIZER_EMAIL,
      keepReplyTo: true,
      attachments: [
        {
          filename: 'atmosphere-demo.ics',
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
          content: buildDemoIcs({
            uid: event.iCalUID || `${event.eventId}@google.com`,
            meetUrl: event.meetUrl,
            start,
            organizerEmail: DEMO_ORGANIZER_EMAIL,
            organizerName: DEMO_ORGANIZER_NAME,
            attendeeEmail: row.email,
            attendeeName: row.name,
            company: row.company,
            now: deps.now,
          }),
        },
      ],
    }))
      ? 'sent'
      : 'failed';
    if (guest === 'failed') await deps.store.release(row.id, 'guest_emailed_at').catch(() => undefined);
  }
  let host: 'sent' | 'failed' | 'already_sent' = 'already_sent';
  if (!row.host_notified_at && (await deps.store.claim(row.id, 'host_notified_at'))) {
    host = (await trySend(deps.send, {
      to: DEMO_ORGANIZER_EMAIL,
      ...demoHostEmail(b, start, event.meetUrl, guest === 'already_sent' ? 'sent' : guest),
      replyTo: `"${row.name.replaceAll('"', "'")}" <${row.email}>`,
      keepReplyTo: true,
    }))
      ? 'sent'
      : 'failed';
    if (host === 'failed') await deps.store.release(row.id, 'host_notified_at').catch(() => undefined);
  }
  return { guest, host };
}

async function trySend(send: DemoMailer, input: Parameters<DemoMailer>[0]): Promise<boolean> {
  try {
    const r = await send(input);
    if (!r.ok) console.error(`[demo] email to ${input.to === DEMO_ORGANIZER_EMAIL ? 'host' : 'guest'} failed:`, r.why);
    return r.ok;
  } catch (err) {
    console.error('[demo] email failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * POST /api/demo/bookings/:id/meet — the routine's fallback path, for bookings the
 * backend could not put on the calendar at booking time. Stores the event + Meet
 * link (unless the booking already has one) and sends whichever of the guest and
 * host emails have not gone out yet. Idempotent.
 */
export async function notifyHostWithMeet(
  id: string,
  input: { meetUrl: string; eventId: string },
  deps: { store: DemoBookingStore; send: DemoMailer; now?: Date },
): Promise<{
  status: 'sent' | 'already_sent' | 'already_handled';
  guest: 'sent' | 'failed' | 'already_sent';
  host: 'sent' | 'failed' | 'already_sent';
}> {
  const row = await deps.store.get(id);
  if (!row) throw new HttpError(404, 'Booking not found.', 'not_found');
  const kept = await deps.store.setMeetOnce(id, input.meetUrl, input.eventId);
  if (kept.eventId !== input.eventId) {
    // The backend already made this booking's event and emailed from it. Never
    // switch the guest to a second link; the caller's extra event is not used.
    return { status: 'already_handled', guest: 'already_sent', host: 'already_sent' };
  }
  const r = await sendBookingEmails(row, kept, deps);
  if (r.host === 'failed' || r.guest === 'failed') {
    throw new HttpError(502, `Demo email failed (guest ${r.guest}, host ${r.host}).`, 'mail_failed');
  }
  const status = r.guest === 'already_sent' && r.host === 'already_sent' ? 'already_sent' : 'sent';
  return { status, ...r };
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

const ROW_COLUMNS =
  'id, slot_start, status, name, email, company, phone, notes, guest_time_zone, host_notified_at, guest_emailed_at, google_event_id, meet_url';

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
    async get(id) {
      const { data, error } = await client.from('demo_bookings').select(ROW_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw new Error(`demo_bookings read failed: ${error.message}`);
      return (data as DemoBookingRow | null) ?? null;
    },
    async setMeetOnce(id, meetUrl, eventId) {
      const { data, error } = await client
        .from('demo_bookings')
        .update({ meet_url: meetUrl, google_event_id: eventId })
        .eq('id', id)
        .is('google_event_id', null)
        .select('google_event_id, meet_url');
      if (error) throw new Error(`demo_bookings update failed: ${error.message}`);
      if ((data ?? []).length > 0) return { eventId, meetUrl };
      const { data: cur, error: readErr } = await client
        .from('demo_bookings')
        .select('google_event_id, meet_url')
        .eq('id', id)
        .maybeSingle();
      if (readErr || !cur) throw new Error(`demo_bookings read failed: ${readErr?.message ?? 'missing'}`);
      return { eventId: String(cur.google_event_id), meetUrl: String(cur.meet_url) };
    },
    async claim(id, field) {
      const { data, error } = await client
        .from('demo_bookings')
        .update({ [field]: new Date().toISOString() })
        .eq('id', id)
        .is(field, null)
        .select('id');
      if (error) throw new Error(`demo_bookings update failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async release(id, field) {
      await client.from('demo_bookings').update({ [field]: null }).eq('id', id);
    },
  };
}

export async function openDemoSlots(store: DemoBookingStore, now: Date = new Date()): Promise<string[]> {
  const all = demoSlotStarts(now);
  if (all.length === 0) return [];
  const taken = new Set(await store.bookedBetween(all[0]!, all[all.length - 1]!));
  return all.filter((s) => !taken.has(s));
}

export type DemoCalendarState = 'created' | 'failed' | 'off';

/**
 * Book a slot. The row is the source of truth: once it is in, the slot is held
 * whatever happens next. Then, with Google Calendar configured:
 *   1. create the booking's event on the host's calendar with its own Meet
 *      link (Google sends no email: sendUpdates=none),
 *   2. send the guest ONE branded email with that link + an .ics,
 *   3. send the host ONE email with the same link.
 * If the calendar is off or Google fails, nothing is emailed now: the
 * "Demo booking Google invites" routine picks the booking up (google_event_id
 * is null) and the meet hook sends the same single email with the link. So a
 * guest never gets a link-less email followed by a second one.
 * `emailed` is true only when the guest's confirmation was accepted for delivery.
 */
export async function bookDemo(
  input: DemoBookingInput,
  deps: {
    store: DemoBookingStore;
    send: DemoMailer;
    calendar: GoogleCalendarClient | null;
    ip: string | null;
    now?: Date;
  },
): Promise<{ id: string; slotStart: string; emailed: boolean; calendar: DemoCalendarState }> {
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
  if (!deps.calendar) return { id: inserted.id, slotStart, emailed: false, calendar: 'off' };

  let event: MeetEvent;
  try {
    const made = await deps.calendar.createDemoEvent({
      bookingId: inserted.id,
      start,
      end: new Date(start.getTime() + DEMO_SLOT_MINUTES * 60_000),
      summary: `Atmosphere demo: ${input.name} (${input.company})`,
      description: [
        `Atmosphere product demo with ${input.name} from ${input.company}.`,
        `Guest: ${input.email}${input.phone ? `, ${input.phone}` : ''}`,
        input.timeZone ? `Guest time zone: ${input.timeZone}` : '',
        input.notes ? `Notes: ${input.notes}` : '',
        'Booked at atmosphereteam.com/demo.',
      ]
        .filter(Boolean)
        .join('\n'),
      attendee: { email: input.email, name: input.name },
    });
    const kept = await deps.store.setMeetOnce(inserted.id, made.meetUrl, made.eventId);
    event = kept.eventId === made.eventId ? { ...kept, iCalUID: made.iCalUID } : kept;
  } catch (err) {
    console.error('[demo] calendar event failed; routine will retry:', err instanceof Error ? err.message : err);
    return { id: inserted.id, slotStart, emailed: false, calendar: 'failed' };
  }

  const row = await deps.store.get(inserted.id).catch(() => null);
  if (!row) return { id: inserted.id, slotStart, emailed: false, calendar: 'created' };
  const r = await sendBookingEmails(row, event, { ...deps, now });
  return { id: inserted.id, slotStart, emailed: r.guest === 'sent', calendar: 'created' };
}

export { DEMO_WINDOW_DAYS };
