import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleDemoEvent, googleCalendarConfigured } from '../src/lib/googleCalendar.js';

const EVENT = {
  requestId: 'demo-1',
  start: new Date('2026-10-15T15:00:00Z'),
  end: new Date('2026-10-15T15:30:00Z'),
  summary: 'Atmosphere product demo: Dana (Ortiz Roofing)',
  description: 'x',
  hostEmail: 'jack@jettx.ai',
  guestEmail: 'dana@example.com',
  guestName: 'Dana',
};

function withEnv(vars: Record<string, string>, fn: () => Promise<void>) {
  return async () => {
    const before = { ...process.env };
    Object.assign(process.env, vars);
    try {
      await fn();
    } finally {
      for (const k of Object.keys(vars)) delete process.env[k];
      Object.assign(process.env, before);
    }
  };
}

test('not configured without credentials', () => {
  delete process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  assert.equal(googleCalendarConfigured(), false);
});

test(
  'creates a Meet event with sendUpdates=all via refresh token',
  withEnv(
    { GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec', GOOGLE_CALENDAR_REFRESH_TOKEN: 'rt' },
    async () => {
      assert.equal(googleCalendarConfigured(), true);
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchFn = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok' }));
        return new Response(
          JSON.stringify({
            id: 'evt1',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          }),
        );
      }) as unknown as typeof fetch;
      const r = await createGoogleDemoEvent(EVENT, fetchFn);
      assert.deepEqual(r, { eventId: 'evt1', meetUrl: 'https://meet.google.com/abc-defg-hij' });
      assert.match(String(calls[0]!.init!.body), /grant_type=refresh_token/);
      assert.match(calls[1]!.url, /conferenceDataVersion=1/);
      assert.match(calls[1]!.url, /sendUpdates=all/);
      const body = JSON.parse(String(calls[1]!.init!.body));
      assert.equal(body.attendees[0].email, 'dana@example.com');
      assert.equal(body.conferenceData.createRequest.requestId, 'demo-1');
      assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
      assert.equal((calls[1]!.init!.headers as Record<string, string>).Authorization, 'Bearer tok');
    },
  ),
);

test(
  'throws when Google refuses, so the caller can fall back',
  withEnv(
    { GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec', GOOGLE_CALENDAR_REFRESH_TOKEN: 'rt' },
    async () => {
      const fetchFn = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
      await assert.rejects(createGoogleDemoEvent(EVENT, fetchFn), /Google OAuth 401/);
    },
  ),
);
