import { createSign } from 'node:crypto';

/**
 * Google Calendar for demo bookings: a real event on the host's calendar with
 * its own Google Meet room, and free/busy so taken hours are never offered.
 *
 * Off unless credentials exist. Two ways to authorise, checked in order:
 *   1. OAuth refresh token for the host (GOOGLE_CALENDAR_CLIENT_ID,
 *      GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN), granted
 *      the calendar.events + calendar.freebusy scopes.
 *   2. Workspace service account with domain-wide delegation
 *      (GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON), impersonating
 *      GOOGLE_CALENDAR_IMPERSONATE (default: the demo host).
 * GOOGLE_CALENDAR_ID picks the calendar (default "primary").
 */

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export type GoogleCalendarEnv = Record<string, string | undefined>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type Creds =
  | { kind: 'oauth'; clientId: string; clientSecret: string; refreshToken: string }
  | { kind: 'service_account'; clientEmail: string; privateKey: string; tokenUri: string; subject: string };

export function calendarCreds(env: GoogleCalendarEnv = process.env, hostEmail = ''): Creds | null {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_CALENDAR_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) return { kind: 'oauth', clientId, clientSecret, refreshToken };
  const raw = env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON?.trim();
  const subject = (env.GOOGLE_CALENDAR_IMPERSONATE || hostEmail).trim();
  if (raw && subject) {
    try {
      const sa = JSON.parse(raw) as { client_email?: string; private_key?: string; token_uri?: string };
      if (sa.client_email && sa.private_key) {
        return {
          kind: 'service_account',
          clientEmail: sa.client_email,
          privateKey: sa.private_key,
          tokenUri: sa.token_uri || 'https://oauth2.googleapis.com/token',
          subject,
        };
      }
    } catch {
      console.error('[gcal] GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }
  return null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export type CalendarEventResult = {
  eventId: string;
  meetUrl: string;
  htmlLink: string | null;
  dialIn: string | null;
  pin: string | null;
};

export type GoogleCalendarClient = {
  createDemoEvent(input: {
    requestId: string;
    start: Date;
    end: Date;
    summary: string;
    description: string;
    attendee: { email: string; name: string };
  }): Promise<CalendarEventResult>;
  busy(from: Date, to: Date): Promise<Array<{ start: number; end: number }>>;
};

export function createGoogleCalendarClient(options: {
  env?: GoogleCalendarEnv;
  hostEmail: string;
  fetch?: FetchLike;
  now?: () => number;
}): GoogleCalendarClient | null {
  const env = options.env ?? process.env;
  const creds = calendarCreds(env, options.hostEmail);
  if (!creds) return null;
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());
  const calendarId = encodeURIComponent((env.GOOGLE_CALENDAR_ID || 'primary').trim());
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    let body: URLSearchParams;
    let tokenUri = 'https://oauth2.googleapis.com/token';
    if (creds!.kind === 'oauth') {
      body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds!.clientId,
        client_secret: creds!.clientSecret,
        refresh_token: creds!.refreshToken,
      });
    } else {
      const iat = Math.floor(now() / 1000);
      const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = b64url(
        JSON.stringify({
          iss: creds!.clientEmail,
          sub: creds!.subject,
          scope: CALENDAR_SCOPES.join(' '),
          aud: creds!.tokenUri,
          iat,
          exp: iat + 3600,
        }),
      );
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      const assertion = `${header}.${claims}.${b64url(signer.sign(creds!.privateKey))}`;
      tokenUri = creds!.tokenUri;
      body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    }
    const res = await doFetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('google token: no access_token');
    cached = { token: json.access_token, expiresAt: now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  async function api<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const res = await doFetch(`https://www.googleapis.com/calendar/v3${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`google calendar ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  return {
    async createDemoEvent(input) {
      const event = await api<{
        id?: string;
        htmlLink?: string;
        hangoutLink?: string;
        conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string; pin?: string }> };
      }>(`/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=all`, {
        method: 'POST',
        body: {
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.start.toISOString() },
          end: { dateTime: input.end.toISOString() },
          attendees: [{ email: input.attendee.email, displayName: input.attendee.name }],
          guestsCanModify: false,
          guestsCanInviteOthers: false,
          reminders: { useDefault: true },
          conferenceData: {
            createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
          },
        },
      });
      const entry = event.conferenceData?.entryPoints ?? [];
      const video = entry.find((e) => e.entryPointType === 'video')?.uri ?? event.hangoutLink ?? null;
      if (!event.id || !video) throw new Error('google calendar: event created without a Meet link');
      const phone = entry.find((e) => e.entryPointType === 'phone');
      return {
        eventId: event.id,
        meetUrl: video,
        htmlLink: event.htmlLink ?? null,
        dialIn: phone?.label ?? (phone?.uri ? phone.uri.replace(/^tel:/, '') : null),
        pin: phone?.pin ? `${phone.pin.replace(/(\d{3})(?=\d)/g, '$1 ')}#` : null,
      };
    },
    async busy(from, to) {
      const out = await api<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(
        '/freeBusy',
        {
          method: 'POST',
          body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: decodeURIComponent(calendarId) }] },
        },
      );
      const cal = Object.values(out.calendars ?? {})[0];
      return (cal?.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
    },
  };
}
