import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
import {
  DEMO_WINDOW_DAYS,
  demoSlotStarts,
  isBookableSlot,
  type DemoBookingInput,
} from './demoBooking.js';
import { demoGuestEmail, demoHostEmail } from './demoBookingEmail.js';

export const DEMO_ORGANIZER_EMAIL = (process.env.DEMO_BOOKING_TO_EMAIL || 'jack@jettx.ai').trim();
export const DEMO_ORGANIZER_NAME = (process.env.DEMO_BOOKING_HOST_NAME || 'Jack Cyganiak').trim();

export type DemoBookingStore = {
  /** Booked slot starts (ISO) between from and to. */
  bookedBetween(fromIso: string, toIso: string): Promise<string[]>;
  /** Insert; resolves 'taken' when the slot's unique index rejects it. */
  insert(row: Record<string, unknown>): Promise<{ id: string } | 'taken'>;
  markEmailed(id: string, field: 'host_emailed_at' | 'guest_emailed_at'): Promise<void>;
};

export type DemoMailer = (input: {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  keepReplyTo?: boolean;
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
  };
}

export async function openDemoSlots(store: DemoBookingStore, now: Date = new Date()): Promise<string[]> {
  const all = demoSlotStarts(now);
  if (all.length === 0) return [];
  const taken = new Set(await store.bookedBetween(all[0]!, all[all.length - 1]!));
  return all.filter((s) => !taken.has(s));
}

/**
 * Book a slot, then email the host and the guest a confirmation (the Google Calendar invite is sent separately). The row is the
 * source of truth: once it is in, the slot is held even if mail fails.
 */
export async function bookDemo(
  input: DemoBookingInput,
  deps: { store: DemoBookingStore; send: DemoMailer; ip: string | null; now?: Date },
): Promise<{ id: string; slotStart: string; hostEmailed: boolean; guestEmailed: boolean }> {
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

  const host = await deps.send({
    to: DEMO_ORGANIZER_EMAIL,
    ...demoHostEmail(input, start),
    replyTo: `"${input.name.replaceAll('"', "'")}" <${input.email}>`,
    keepReplyTo: true,
  });
  if (host.ok) await deps.store.markEmailed(inserted.id, 'host_emailed_at').catch(() => undefined);
  else console.error('[demo] host email failed:', host.why);

  const guest = await deps.send({
    to: input.email,
    ...demoGuestEmail(input, start, DEMO_ORGANIZER_NAME),
    replyTo: DEMO_ORGANIZER_EMAIL,
    keepReplyTo: true,
  });
  if (guest.ok) await deps.store.markEmailed(inserted.id, 'guest_emailed_at').catch(() => undefined);
  else console.error('[demo] guest email failed:', guest.why);

  return { id: inserted.id, slotStart, hostEmailed: host.ok, guestEmailed: guest.ok };
}

export { DEMO_WINDOW_DAYS };
