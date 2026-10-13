import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
import {
  DEMO_MEET_URL,
  DEMO_SLOT_MINUTES,
  DEMO_WINDOW_DAYS,
  buildDemoIcs,
  demoSlotStarts,
  isBookableSlot,
  type DemoBookingInput,
} from './demoBooking.js';
import { demoGuestEmail, demoHostEmail } from './demoBookingEmail.js';
import type { DemoCalendarEvent } from './googleCalendar.js';
import type { MailAttachment } from './systemMail.js';

export const DEMO_ORGANIZER_EMAIL = (process.env.DEMO_BOOKING_TO_EMAIL || 'jack@jettx.ai').trim();
export const DEMO_ORGANIZER_NAME = (process.env.DEMO_BOOKING_HOST_NAME || 'Jack Cyganiak').trim();

export type DemoBookingStore = {
  /** Booked slot starts (ISO) between from and to. */
  bookedBetween(fromIso: string, toIso: string): Promise<string[]>;
  /** Insert; resolves 'taken' when the slot's unique index rejects it. */
  insert(row: Record<string, unknown>): Promise<{ id: string } | 'taken'>;
  markEmailed(id: string, field: 'host_emailed_at' | 'guest_emailed_at'): Promise<void>;
  /** The booking, or null. */
  get(id: string): Promise<DemoBookingRow | null>;
  /** Store the booking's Meet link and, when Google made one, its calendar event. */
  setMeet(id: string, meetUrl: string, eventId: string | null): Promise<void>;
  /** Atomically set host_notified_at if still null; false if already set. */
  claimHostNotified(id: string): Promise<boolean>;
  releaseHostNotified(id: string): Promise<void>;
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
};

/**
 * The host's one email for a booking, sent once the routine has created the
 * Google Calendar event: booker details plus a Join meeting button.
 * Idempotent via host_notified_at.
 */
export async function notifyHostWithMeet(
  id: string,
  input: { meetUrl: string; eventId: string | null },
  deps: { store: DemoBookingStore; send: DemoMailer },
): Promise<{ status: 'sent' | 'already_sent' }> {
  const row = await deps.store.get(id);
  if (!row) throw new HttpError(404, 'Booking not found.', 'not_found');
  await deps.store.setMeet(id, input.meetUrl, input.eventId);
  if (row.host_notified_at || !(await deps.store.claimHostNotified(id))) return { status: 'already_sent' };
  const b = {
    slotStart: new Date(row.slot_start).toISOString(),
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone ?? '',
    notes: row.notes ?? '',
    timeZone: row.guest_time_zone ?? '',
    website: '',
  } as DemoBookingInput;
  const sent = await deps.send({
    to: DEMO_ORGANIZER_EMAIL,
    ...demoHostEmail(b, new Date(row.slot_start), input.meetUrl),
    replyTo: `"${row.name.replaceAll('"', "'")}" <${row.email}>`,
    keepReplyTo: true,
  });
  if (!sent.ok) {
    await deps.store.releaseHostNotified(id).catch(() => undefined);
    throw new HttpError(502, `Host email failed: ${sent.why}`, 'mail_failed');
  }
  return { status: 'sent' };
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

/** Creates the booking's Google Calendar event (Google emails the guest). */
export type DemoCalendar = (event: DemoCalendarEvent) => Promise<{ eventId: string; meetUrl: string }>;

/** How the guest's one invite went out. */
export type DemoInvite = 'google' | 'email' | 'none';

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
      const { data, error } = await client
        .from('demo_bookings')
        .select('id, slot_start, status, name, email, company, phone, notes, guest_time_zone, host_notified_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`demo_bookings read failed: ${error.message}`);
      return (data as DemoBookingRow | null) ?? null;
    },
    async setMeet(id, meetUrl, eventId) {
      const { error } = await client.from('demo_bookings').update({ meet_url: meetUrl, google_event_id: eventId }).eq('id', id);
      if (error) throw new Error(`demo_bookings update failed: ${error.message}`);
    },
    async claimHostNotified(id) {
      const { data, error } = await client
        .from('demo_bookings')
        .update({ host_notified_at: new Date().toISOString() })
        .eq('id', id)
        .is('host_notified_at', null)
        .select('id');
      if (error) throw new Error(`demo_bookings update failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async releaseHostNotified(id) {
      await client.from('demo_bookings').update({ host_notified_at: null }).eq('id', id);
    },
    async markEmailed(id, field) {
      await client.from('demo_bookings').update({ [field]: new Date().toISOString() }).eq('id', id);
    },
  };
}

export async function openDemoSlots(store: DemoBookingStore, now: Date = new Date()): Promise<string[]> {
  const all = demoSlotStarts(now);
  if (all.length === 0) return [];
  const taken = new Set(await store.bookedBetween(all[0]!, all[all.length - 1]!));
  return all.filter((s) => !taken.has(s));
}

/**
 * Book a slot and send the guest exactly one invite with a join link. The row
 * is the source of truth: once it is in, the slot is held even if mail fails.
 */
export async function bookDemo(
  input: DemoBookingInput,
  deps: {
    store: DemoBookingStore;
    send: DemoMailer;
    ip: string | null;
    now?: Date;
    /** Google Calendar, when credentials are set; null sends our own .ics invite. */
    calendar?: DemoCalendar | null;
  },
): Promise<{ id: string; slotStart: string; invite: DemoInvite }> {
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

  const invite = await inviteGuest(inserted.id, input, start, deps);
  return { id: inserted.id, slotStart, invite };
}

/**
 * The guest gets ONE email with a join link:
 *  - Google Calendar configured: a per-booking event with its own Meet link,
 *    and Google sends the guest its invite (sendUpdates=all).
 *  - Otherwise, or if Google fails: our branded email with the host's Meet
 *    room, a Join meeting button and an .ics invite attached.
 * Then the host gets one email with the same link. Mail failures never undo
 * the booking.
 */
async function inviteGuest(
  id: string,
  input: DemoBookingInput,
  start: Date,
  deps: { store: DemoBookingStore; send: DemoMailer; calendar?: DemoCalendar | null },
): Promise<DemoInvite> {
  const notifyHost = (meetUrl: string, eventId: string | null) =>
    notifyHostWithMeet(id, { meetUrl, eventId }, deps).catch((err) =>
      console.error('[demo] host email failed:', (err as Error)?.message ?? err),
    );

  if (deps.calendar) {
    try {
      const ev = await deps.calendar({
        requestId: `demo-${id}`,
        start,
        end: new Date(start.getTime() + DEMO_SLOT_MINUTES * 60 * 1000),
        summary: `Atmosphere product demo: ${input.name} (${input.company})`,
        description: [
          `Atmosphere product demo with ${DEMO_ORGANIZER_NAME}.`,
          '',
          `Guest: ${input.name} (${input.company}), ${input.email}`,
          input.phone ? `Phone: ${input.phone}` : '',
          input.notes ? `Notes: ${input.notes}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        hostEmail: DEMO_ORGANIZER_EMAIL,
        guestEmail: input.email,
        guestName: input.name,
      });
      // Google has sent the invite; nothing after this may fall through to a second one.
      await deps.store.markEmailed(id, 'guest_emailed_at').catch(() => undefined);
      await notifyHost(ev.meetUrl, ev.eventId);
      return 'google';
    } catch (err) {
      console.error('[demo] Google Calendar invite failed, sending our own:', (err as Error)?.message ?? err);
    }
  }

  const ics = buildDemoIcs({
    uid: id,
    start,
    organizerEmail: DEMO_ORGANIZER_EMAIL,
    organizerName: DEMO_ORGANIZER_NAME,
    attendeeEmail: input.email,
    attendeeName: input.name,
    company: input.company,
    phone: input.phone,
    notes: input.notes,
  });
  const sent = await deps.send({
    to: input.email,
    ...demoGuestEmail(input, start, DEMO_ORGANIZER_NAME, DEMO_MEET_URL),
    replyTo: `"${DEMO_ORGANIZER_NAME.replaceAll('"', "'")}" <${DEMO_ORGANIZER_EMAIL}>`,
    keepReplyTo: true,
    attachments: [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }],
  });
  if (sent.ok) await deps.store.markEmailed(id, 'guest_emailed_at').catch(() => undefined);
  else console.error('[demo] guest invite email failed:', sent.why);
  await notifyHost(DEMO_MEET_URL, null);
  return sent.ok ? 'email' : 'none';
}

export { DEMO_WINDOW_DAYS };
