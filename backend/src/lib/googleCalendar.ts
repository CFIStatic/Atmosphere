import { createSign } from 'node:crypto';

/**
 * Google Calendar for demo bookings: one event per booking on the host's
 * calendar, with its own Google Meet link, created with sendUpdates=all so
 * Google emails the guest the invite (Join button included).
 *
 * Credentials, either:
 *  - OAuth: GOOGLE_CALENDAR_CLIENT_ID + GOOGLE_CALENDAR_CLIENT_SECRET +
 *    GOOGLE_CALENDAR_REFRESH_TOKEN (consented as the host, scope
 *    calendar.events), or
 *  - Workspace service account with domain-wide delegation:
 *    GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON, impersonating the host.
 */

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function googleCalendarConfigured(): boolean {
  return Boolean(
    env('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON') ||
      (env('GOOGLE_CALENDAR_CLIENT_ID') && env('GOOGLE_CALENDAR_CLIENT_SECRET') && env('GOOGLE_CALENDAR_REFRESH_TOKEN')),
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(hostEmail: string, fetchFn: typeof fetch): Promise<string> {
  let body: URLSearchParams;
  let tokenUri = TOKEN_URI;
  const saJson = env('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON');
  if (saJson) {
    const sa = JSON.parse(saJson) as { client_email?: string; private_key?: string; token_uri?: string };
    if (!sa.client_email || !sa.private_key) throw new Error('calendar service account JSON is missing client_email or private_key');
    tokenUri = sa.token_uri || TOKEN_URI;
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({ iss: sa.client_email, sub: hostEmail, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 600 }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64url(signer.sign(sa.private_key))}`;
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  } else {
    body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env('GOOGLE_CALENDAR_CLIENT_ID'),
      client_secret: env('GOOGLE_CALENDAR_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_CALENDAR_REFRESH_TOKEN'),
    });
  }
  const res = await fetchFn(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Google OAuth returned no access token');
  return json.access_token;
}

type GoogleEvent = {
  id?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

function meetLink(ev: GoogleEvent): string | null {
  const video = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  const link = ev.hangoutLink || video || '';
  return link.startsWith('https://') ? link : null;
}

export type DemoCalendarEvent = {
  /** Stable per booking so a retry never makes a second Meet room. */
  requestId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  hostEmail: string;
  guestEmail: string;
  guestName: string;
};

/**
 * Create the event on the host's primary calendar with a new Meet link and
 * have Google email the guest the invite. Resolves the event id and Meet URL.
 */
export async function createGoogleDemoEvent(
  input: DemoCalendarEvent,
  fetchFn: typeof fetch = fetch,
): Promise<{ eventId: string; meetUrl: string }> {
  const token = await accessToken(input.hostEmail, fetchFn);
  const auth = { Authorization: `Bearer ${token}` };
  const url =
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all';
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString() },
      end: { dateTime: input.end.toISOString() },
      attendees: [{ email: input.guestEmail, displayName: input.guestName }],
      conferenceData: {
        createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      reminders: { useDefault: true },
      guestsCanModify: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google Calendar insert ${res.status}`);
  let ev = (await res.json()) as GoogleEvent;
  const eventId = ev.id;
  if (!eventId) throw new Error('Google Calendar returned no event id');
  // Meet rooms are almost always ready on insert; if still pending, look once more.
  if (!meetLink(ev) && ev.conferenceData?.createRequest?.status?.statusCode === 'pending') {
    await new Promise((r) => setTimeout(r, 1500));
    const again = await fetchFn(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { headers: auth, signal: AbortSignal.timeout(15_000) },
    );
    if (again.ok) ev = (await again.json()) as GoogleEvent;
  }
  const meetUrl = meetLink(ev);
  if (!meetUrl) throw new Error('Google Calendar event has no Meet link');
  return { eventId, meetUrl };
}
