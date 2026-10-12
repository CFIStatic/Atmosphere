import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDemoIcs,
  chicagoToUtc,
  chicagoWallClock,
  demoBookingSchema,
  demoSlotStarts,
  isBookableSlot,
} from '../src/lib/demoBooking.js';
import {
  bookDemo,
  openDemoSlots,
  type DemoBookingStore,
  type DemoMailer,
} from '../src/lib/demoBookingService.js';
import type { MailAttachment } from '../src/lib/systemMail.js';

// Monday Oct 12 2026, 8:00 AM CDT.
const NOW = new Date('2026-10-12T13:00:00Z');

test('chicagoToUtc handles CDT and CST', () => {
  assert.equal(chicagoToUtc(2026, 10, 12, 9, 0).toISOString(), '2026-10-12T14:00:00.000Z');
  assert.equal(chicagoToUtc(2026, 11, 2, 9, 0).toISOString(), '2026-11-02T15:00:00.000Z');
});

test('slots: weekdays only, 9:00–4:30 CT start, 30 min apart, 2h lead, ~3 weeks', () => {
  const slots = demoSlotStarts(NOW);
  assert.ok(slots.length > 200);
  for (const s of slots) {
    const w = chicagoWallClock(new Date(s));
    assert.ok(!['Sat', 'Sun'].includes(w.weekday), s);
    assert.ok(w.h >= 9 && w.h < 17, s);
    assert.ok(w.min === 0 || w.min === 30, s);
    assert.ok(Date.parse(s) >= NOW.getTime() + 2 * 3600_000, s);
  }
  assert.equal(slots[0], '2026-10-12T15:00:00.000Z', 'first slot today is 10:00 AM CT');
  const last = new Date(slots[slots.length - 1]!);
  assert.ok(last.getTime() - NOW.getTime() <= 22 * 86400_000);
  // Across the Nov 1 DST change, 9:00 AM CT stays 9:00 AM CT.
  assert.ok(slots.includes('2026-11-02T15:00:00.000Z'));
  assert.ok(!slots.includes('2026-10-17T15:00:00.000Z'), 'no Saturday');
  assert.equal(isBookableSlot('2026-10-13T21:30:00Z', NOW), true, '4:30 PM CT is the last slot');
  assert.equal(isBookableSlot('2026-10-13T22:00:00Z', NOW), false, '5:00 PM CT is not bookable');
  assert.equal(isBookableSlot('2026-10-13T14:15:00Z', NOW), false);
  assert.equal(isBookableSlot('garbage', NOW), false);
});

test('schema validates and normalises; phone and notes optional', () => {
  const ok = demoBookingSchema.parse({
    slotStart: '2026-10-13T15:00:00.000Z',
    name: ' Dana ',
    email: 'Dana@Example.com',
    company: 'Ortiz Roofing',
  });
  assert.equal(ok.email, 'dana@example.com');
  assert.equal(ok.phone, '');
  assert.equal(ok.website, '');
  assert.throws(() =>
    demoBookingSchema.parse({ slotStart: 'x', name: 'D', email: 'nope', company: 'C' }),
  );
  assert.throws(() =>
    demoBookingSchema.parse({ slotStart: 'x', name: 'D', email: 'd@e.com', company: '' }),
  );
  assert.throws(() =>
    demoBookingSchema.parse({
      slotStart: 'x',
      name: 'D',
      email: 'd@e.com',
      company: 'C',
      phone: '<script>',
    }),
  );
});

test('ics is a valid 30-minute REQUEST with both people and escaped text', () => {
  const ics = buildDemoIcs({
    uid: 'abc',
    start: new Date('2026-10-13T15:00:00Z'),
    organizerEmail: 'jack@jettx.ai',
    organizerName: 'Jack',
    attendeeEmail: 'dana@example.com',
    attendeeName: 'Dana, Ortiz',
    company: 'Ortiz; Roofing',
    now: NOW,
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /DTSTART:20261013T150000Z/);
  assert.match(ics, /DTEND:20261013T153000Z/);
  assert.match(ics, /UID:abc@atmosphereteam.com/);
  assert.match(ics, /ORGANIZER;CN=Jack:mailto:jack@jettx.ai/);
  assert.match(ics, /mailto:dana@example.com/);
  assert.match(ics, /Guest: Dana\\, Ortiz \(Ortiz\\; Roofing\)/);
  assert.match(ics, /\r\nSUMMARY:Atmosphere product demo\r\n/);
  assert.match(ics, /\r\nLOCATION:https:\/\/meet\.google\.com\/wcd-dsir-qyg\r\n/);
  assert.match(ics, /\r\nURL:https:\/\/meet\.google\.com\/wcd-dsir-qyg\r\n/);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /Join with Google Meet: https:\/\/meet\.google\.com\/wcd-dsir-qyg/);
  assert.match(unfolded, /Join by phone: \+1 502-947-4063\\, PIN: 126 500 844#/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});

function memStore(): DemoBookingStore & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    async bookedBetween() {
      return rows.filter((r) => r.status === 'booked').map((r) => String(r.slot_start));
    },
    async insert(row) {
      if (rows.some((r) => r.status === 'booked' && r.slot_start === row.slot_start))
        return 'taken';
      const id = `id-${rows.length + 1}`;
      rows.push({ ...row, id });
      return { id };
    },
    async markEmailed(id, field) {
      const r = rows.find((x) => x.id === id);
      if (r) r[field] = 'now';
    },
  };
}

test('booking: stores, emails host and guest with .ics (stubbed), blocks double booking', async () => {
  const store = memStore();
  const sent: Array<{ to: string; subject: string; attachments?: MailAttachment[] }> = [];
  const send: DemoMailer = async (m) => {
    sent.push(m);
    return { ok: true };
  };
  const slot = '2026-10-13T15:00:00.000Z';
  const input = demoBookingSchema.parse({
    slotStart: slot,
    name: 'Dana Ortiz',
    email: 'dana@example.com',
    company: 'Ortiz Roofing',
    phone: '(555) 010-2000',
    notes: 'Three crews',
    timeZone: 'America/New_York',
  });
  const r = await bookDemo(input, { store, send, ip: '203.0.113.9', now: NOW });
  assert.equal(r.slotStart, slot);
  assert.equal(r.hostEmailed && r.guestEmailed, true);
  assert.equal(store.rows[0]!.client_ip, '203.0.113.9');
  assert.deepEqual(
    sent.map((m) => m.to),
    ['jack@jettx.ai', 'dana@example.com'],
  );
  for (const m of sent) {
    assert.equal(m.attachments?.[0]?.filename, 'atmosphere-demo.ics');
    assert.match(m.attachments?.[0]?.content ?? '', /DTSTART:20261013T150000Z/);
  }

  const open = await openDemoSlots(store, NOW);
  assert.ok(!open.includes(slot), 'booked slot is hidden');

  await assert.rejects(
    bookDemo(input, { store, send, ip: null, now: NOW }),
    (e: { status?: number }) => e.status === 409,
  );
  await assert.rejects(
    bookDemo(
      { ...input, slotStart: '2026-10-17T15:00:00.000Z' },
      { store, send, ip: null, now: NOW },
    ),
    (e: { code?: string }) => e.code === 'slot_unavailable',
  );
  assert.equal(store.rows.length, 1);
});

test('booking: slot is held even when mail fails', async () => {
  const store = memStore();
  const send: DemoMailer = async () => ({ ok: false, why: 'down' });
  const input = demoBookingSchema.parse({
    slotStart: '2026-10-14T15:00:00.000Z',
    name: 'D',
    email: 'd@example.com',
    company: 'C',
  });
  const r = await bookDemo(input, { store, send, ip: null, now: NOW });
  assert.equal(r.guestEmailed, false);
  assert.equal(store.rows.length, 1);
});
