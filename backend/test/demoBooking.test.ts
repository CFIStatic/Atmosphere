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
  notifyHostWithMeet,
  openDemoSlots,
  type DemoBookingStore,
  type DemoMailer,
} from '../src/lib/demoBookingService.js';
import type { GoogleCalendarClient, DemoEventInput } from '../src/lib/googleCalendar.js';

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

test('ics: 30-minute REQUEST on the booking\'s own Meet link and Google iCalUID, escaped, folded', () => {
  const ics = buildDemoIcs({
    uid: 'demoabc123@google.com',
    meetUrl: 'https://meet.google.com/xyz-abcd-efg',
    start: new Date('2026-10-13T15:00:00Z'),
    organizerEmail: 'host@example.com',
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
  assert.match(ics, /\r\nUID:demoabc123@google.com\r\n/);
  assert.match(ics, /ORGANIZER;CN=Jack:mailto:host@example.com/);
  assert.match(ics, /mailto:dana@example.com/);
  assert.match(ics, /\r\nLOCATION:https:\/\/meet\.google\.com\/xyz-abcd-efg\r\n/);
  assert.match(ics, /\r\nURL:https:\/\/meet\.google\.com\/xyz-abcd-efg\r\n/);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /Guest: Dana\\, Ortiz \(Ortiz\\; Roofing\)/);
  assert.ok(!/wcd-dsir-qyg|502-947-4063|PIN/.test(unfolded), 'no shared room or dial-in');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.throws(() => buildDemoIcs({ uid: 'u', meetUrl: '', start: NOW, organizerEmail: 'a@example.com', organizerName: 'A', attendeeEmail: 'b@example.com', attendeeName: 'B', company: 'C' }));
});

type Row = Record<string, unknown>;
function memStore(): DemoBookingStore & { rows: Row[] } {
  const rows: Row[] = [];
  const find = (id: string) => rows.find((x) => x.id === id);
  return {
    rows,
    async bookedBetween() {
      return rows.filter((r) => r.status === 'booked').map((r) => String(r.slot_start));
    },
    async insert(row) {
      if (rows.some((r) => r.status === 'booked' && r.slot_start === row.slot_start)) return 'taken';
      const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`;
      rows.push({ host_notified_at: null, guest_emailed_at: null, google_event_id: null, meet_url: null, ...row, id });
      return { id };
    },
    async get(id) {
      const r = find(id);
      return r ? ({ ...r } as never) : null;
    },
    async setMeetOnce(id, meetUrl, eventId) {
      const r = find(id)!;
      if (!r.google_event_id) Object.assign(r, { meet_url: meetUrl, google_event_id: eventId });
      return { eventId: String(r.google_event_id), meetUrl: String(r.meet_url) };
    },
    async claim(id, field) {
      const r = find(id);
      if (!r || r[field]) return false;
      r[field] = 'now';
      return true;
    },
    async release(id, field) {
      const r = find(id);
      if (r) r[field] = null;
    },
  };
}

type Sent = Parameters<DemoMailer>[0];
function mailer(fail: (m: Sent) => boolean = () => false) {
  const sent: Sent[] = [];
  const send: DemoMailer = async (m) => {
    if (fail(m)) return { ok: false, why: 'down' };
    sent.push(m);
    return { ok: true };
  };
  return { sent, send };
}

const FAKE_MEET = 'https://meet.google.com/abc-defg-hij';
function fakeCalendar(opts: { fail?: boolean } = {}) {
  const calls: DemoEventInput[] = [];
  const client: GoogleCalendarClient = {
    async createDemoEvent(input) {
      calls.push(input);
      if (opts.fail) throw new Error('google calendar 503');
      return { eventId: `demo${input.bookingId.replace(/-/g, '')}`, iCalUID: 'evt-ical@google.com', meetUrl: FAKE_MEET, existed: false };
    },
  };
  return { client, calls };
}

const dana = () =>
  demoBookingSchema.parse({
    slotStart: '2026-10-13T15:00:00.000Z',
    name: 'Dana Ortiz',
    email: 'dana@example.com',
    company: 'Ortiz Roofing',
    phone: '(555) 010-2000',
    notes: 'Three crews',
    timeZone: 'America/New_York',
  });

test('booking with calendar: one event (no Google email), ONE guest email with the Meet link + .ics, ONE host email', async () => {
  const store = memStore();
  const { sent, send } = mailer();
  const cal = fakeCalendar();
  const input = dana();
  const r = await bookDemo(input, { store, send, calendar: cal.client, ip: '203.0.113.9', now: NOW });
  assert.deepEqual([r.emailed, r.calendar, r.slotStart], [true, 'created', input.slotStart]);
  assert.equal(cal.calls.length, 1);
  assert.equal(cal.calls[0]!.attendee.email, 'dana@example.com');
  assert.equal(cal.calls[0]!.end.getTime() - cal.calls[0]!.start.getTime(), 30 * 60_000);
  const row = store.rows[0]!;
  assert.equal(row.client_ip, '203.0.113.9');
  assert.equal(row.meet_url, FAKE_MEET);
  assert.equal(row.google_event_id, `demo${String(row.id).replace(/-/g, '')}`);
  assert.equal(row.guest_emailed_at, 'now');
  assert.equal(row.host_notified_at, 'now');

  const toGuest = sent.filter((m) => m.to === 'dana@example.com');
  const toHost = sent.filter((m) => m.to === 'jack@jettx.ai');
  assert.equal(toGuest.length, 1, 'exactly one guest email');
  assert.equal(toHost.length, 1, 'exactly one host email');
  assert.equal(sent.length, 2);
  const g = toGuest[0]!;
  assert.equal(g.subject, 'Your Atmosphere demo is confirmed: Tue Oct 13, 11:00 AM EDT');
  assert.equal(g.replyTo, 'jack@jettx.ai');
  assert.match(g.html ?? '', /href="https:\/\/meet\.google\.com\/abc-defg-hij"[^>]*>Join meeting</);
  assert.match(g.text, /Join with Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(g.text, /11:00 – 11:30 AM EDT/);
  assert.ok(!/AM CT|wcd-dsir-qyg|502-947-4063|Dec(ember)? 31|Three crews/.test(`${g.html}${g.text}`));
  assert.equal(g.attachments?.length, 1);
  assert.equal(g.attachments![0]!.filename, 'atmosphere-demo.ics');
  assert.match(g.attachments![0]!.content, /UID:evt-ical@google.com/);
  assert.match(g.attachments![0]!.content, /URL:https:\/\/meet\.google\.com\/abc-defg-hij/);
  const h = toHost[0]!;
  assert.match(h.html ?? '', />Join meeting</);
  assert.match(h.text, /Join meeting: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(h.text, /Guest email: Confirmation with this Join link sent/);

  // The routine calling the meet hook afterwards changes nothing and sends nothing.
  const again = await notifyHostWithMeet(String(row.id), { meetUrl: 'https://meet.google.com/zzz-zzzz-zzz', eventId: 'routine-evt' }, { store, send });
  assert.equal(again.status, 'already_handled');
  assert.equal(row.meet_url, FAKE_MEET);
  const same = await notifyHostWithMeet(String(row.id), { meetUrl: FAKE_MEET, eventId: String(row.google_event_id) }, { store, send });
  assert.equal(same.status, 'already_sent');
  assert.equal(sent.length, 2, 'no duplicates for guest or host');

  await assert.rejects(bookDemo(input, { store, send, calendar: cal.client, ip: null, now: NOW }), (e: { status?: number }) => e.status === 409);
  await assert.rejects(
    bookDemo({ ...input, slotStart: '2026-10-17T15:00:00.000Z' }, { store, send, calendar: cal.client, ip: null, now: NOW }),
    (e: { code?: string }) => e.code === 'slot_unavailable',
  );
  assert.ok(!(await openDemoSlots(store, NOW)).includes(input.slotStart), 'booked slot is hidden');
  assert.equal(store.rows.length, 1);
  assert.equal(cal.calls.length, 1);
});

test('calendar off or failing: slot held, nothing emailed (emailed=false); the meet hook later sends the one email with the link', async () => {
  for (const calendar of [null, fakeCalendar({ fail: true }).client]) {
    const store = memStore();
    const { sent, send } = mailer();
    const r = await bookDemo(dana(), { store, send, calendar, ip: null, now: NOW });
    assert.deepEqual([r.emailed, r.calendar], [false, calendar ? 'failed' : 'off']);
    assert.equal(sent.length, 0, 'no link-less email');
    const row = store.rows[0]!;
    assert.equal(row.google_event_id, null, 'routine keys on this');

    const hook = await notifyHostWithMeet(String(row.id), { meetUrl: FAKE_MEET, eventId: 'routine-evt' }, { store, send });
    assert.deepEqual([hook.status, hook.guest, hook.host], ['sent', 'sent', 'sent']);
    assert.equal(sent.filter((m) => m.to === 'dana@example.com').length, 1);
    assert.equal(sent.filter((m) => m.to === 'jack@jettx.ai').length, 1);
    const g = sent.find((m) => m.to === 'dana@example.com')!;
    assert.match(g.text, /Join with Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/);
    assert.match(g.attachments![0]!.content, /UID:routine-evt@google.com/);
    assert.equal((await notifyHostWithMeet(String(row.id), { meetUrl: FAKE_MEET, eventId: 'routine-evt' }, { store, send })).status, 'already_sent');
    assert.equal(sent.length, 2);
  }
});

test('guest mail fails after the event exists: emailed=false, host is told it was not delivered, no retries spam', async () => {
  const store = memStore();
  const { sent, send } = mailer((m) => m.to === 'dana@example.com');
  const r = await bookDemo(dana(), { store, send, calendar: fakeCalendar().client, ip: null, now: NOW });
  assert.deepEqual([r.emailed, r.calendar], [false, 'created']);
  assert.equal(store.rows[0]!.guest_emailed_at, null, 'released so a resend is possible');
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /Guest email: Confirmation NOT delivered/);
});

test('a throwing mailer never fails the booking', async () => {
  const store = memStore();
  const send: DemoMailer = async () => {
    throw new Error('socket hang up');
  };
  const r = await bookDemo(dana(), { store, send, calendar: fakeCalendar().client, ip: null, now: NOW });
  assert.equal(r.emailed, false);
  assert.equal(store.rows.length, 1);
});

test('meet hook: 404 for unknown booking; 502 and released markers when mail is down', async () => {
  const store = memStore();
  let down = true;
  const { sent, send } = mailer(() => down);
  const { id } = await bookDemo(dana(), { store, send, calendar: null, ip: null, now: NOW });
  await assert.rejects(notifyHostWithMeet(id, { meetUrl: FAKE_MEET, eventId: 'e1' }, { store, send }), (e: { status?: number }) => e.status === 502);
  assert.equal(store.rows[0]!.host_notified_at, null);
  assert.equal(store.rows[0]!.guest_emailed_at, null);
  down = false;
  assert.equal((await notifyHostWithMeet(id, { meetUrl: FAKE_MEET, eventId: 'e1' }, { store, send })).status, 'sent');
  assert.equal(sent.length, 2);
  await assert.rejects(notifyHostWithMeet('nope', { meetUrl: FAKE_MEET, eventId: 'e1' }, { store, send }), (e: { status?: number }) => e.status === 404);
});
