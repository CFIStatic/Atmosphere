import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarConfigured, createGoogleCalendarClient, demoEventId } from '../src/lib/googleCalendar.js';

const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: 'cid',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'csecret',
  GOOGLE_CALENDAR_REFRESH_TOKEN: 'rtoken',
};
const BOOKING = '3f2b9c1e-1111-4abc-9def-0123456789ab';
const EVENT_ID = 'demo3f2b9c1e11114abc9def0123456789ab';
const input = {
  bookingId: BOOKING,
  start: new Date('2026-10-13T15:00:00Z'),
  end: new Date('2026-10-13T15:30:00Z'),
  summary: 'Atmosphere demo: Dana (Ortiz Roofing)',
  description: 'd',
  attendee: { email: 'dana@example.com', name: 'Dana' },
};

type Call = { url: string; init?: RequestInit };
function fakeFetch(routes: Array<(c: Call) => Response | null>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    for (const r of routes) {
      const res = r(c);
      if (res) return res;
    }
    throw new Error(`unexpected ${url}`);
  };
  return { f, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const tokenRoute = (c: Call) => (c.url.includes('oauth2.googleapis.com/token') ? json(200, { access_token: 'at', expires_in: 3600 }) : null);
const created = { id: EVENT_ID, iCalUID: `${EVENT_ID}@google.com`, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } };

test('off unless all three OAuth values exist', () => {
  assert.equal(calendarConfigured({}), false);
  assert.equal(calendarConfigured({ ...ENV, GOOGLE_CALENDAR_REFRESH_TOKEN: ' ' }), false);
  assert.equal(createGoogleCalendarClient({ env: {} }), null);
  assert.equal(calendarConfigured(ENV), true);
});

test('event id is derived from the booking id (Google base32hex)', () => {
  assert.equal(demoEventId(BOOKING), EVENT_ID);
  assert.match(demoEventId(BOOKING), /^[a-v0-9]{5,1024}$/);
  assert.throws(() => demoEventId('nope'));
});

test('creates the event with sendUpdates=none, a Meet request and the derived id', async () => {
  const { f, calls } = fakeFetch([tokenRoute, (c) => (c.init?.method === 'POST' && c.url.includes('/events?') ? json(200, created) : null)]);
  const client = createGoogleCalendarClient({ env: ENV, fetch: f })!;
  const r = await client.createDemoEvent(input);
  assert.deepEqual(r, { eventId: EVENT_ID, iCalUID: `${EVENT_ID}@google.com`, meetUrl: 'https://meet.google.com/abc-defg-hij', existed: false });
  const post = calls.find((c) => c.url.includes('/events?'))!;
  assert.match(post.url, /\/calendars\/primary\/events\?conferenceDataVersion=1&sendUpdates=none$/);
  assert.ok(!/sendUpdates=(all|externalOnly)/.test(post.url));
  const body = JSON.parse(String(post.init!.body));
  assert.equal(body.id, EVENT_ID);
  assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.deepEqual(body.attendees, [{ email: 'dana@example.com', displayName: 'Dana' }]);
  assert.equal(post.init!.headers && (post.init!.headers as Record<string, string>).Authorization, 'Bearer at');
});

test('409 (event already made for this booking) reads it back instead of making a second one', async () => {
  const { f, calls } = fakeFetch([
    tokenRoute,
    (c) => (c.init?.method === 'POST' && c.url.includes('/events?') ? json(409, { error: { message: 'duplicate' } }) : null),
    (c) => (c.init?.method === 'GET' && c.url.includes(`/events/${EVENT_ID}`) ? json(200, created) : null),
  ]);
  const r = await createGoogleCalendarClient({ env: ENV, fetch: f })!.createDemoEvent(input);
  assert.equal(r.existed, true);
  assert.equal(r.meetUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(calls.filter((c) => c.init?.method === 'POST' && c.url.includes('/events?')).length, 1);
});

test('pending Meet room is re-read; no Meet link at all is an error', async () => {
  let reads = 0;
  const pending = { id: EVENT_ID, conferenceData: { createRequest: { status: { statusCode: 'pending' } } } };
  const { f } = fakeFetch([
    tokenRoute,
    (c) => (c.init?.method === 'POST' ? json(200, pending) : null),
    (c) => (c.init?.method === 'GET' ? json(200, ++reads < 2 ? pending : created) : null),
  ]);
  const r = await createGoogleCalendarClient({ env: ENV, fetch: f, sleep: async () => {} })!.createDemoEvent(input);
  assert.equal(r.meetUrl, 'https://meet.google.com/abc-defg-hij');

  const { f: f2 } = fakeFetch([tokenRoute, () => json(200, { id: EVENT_ID, hangoutLink: 'https://evil.example/room' })]);
  await assert.rejects(createGoogleCalendarClient({ env: ENV, fetch: f2, sleep: async () => {} })!.createDemoEvent(input), /no Meet link/);
});

test('token failure does not echo the token response', async () => {
  const { f } = fakeFetch([() => new Response('{"error":"invalid_grant","refresh_token":"rtoken"}', { status: 400 })]);
  await assert.rejects(createGoogleCalendarClient({ env: ENV, fetch: f })!.createDemoEvent(input), (e: Error) => e.message === 'google token 400');
});
