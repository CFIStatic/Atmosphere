/**
 * Google Calendar for demo bookings: one event per booking on the host's
 * calendar, with its own Google Meet room. Google sends NO email for it
 * (sendUpdates=none); the guest's only email is our branded confirmation.
 *
 * Off unless all three OAuth values exist (the host's refresh token, granted
 * https://www.googleapis.com/auth/calendar.events):
 *   GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN
 * GOOGLE_CALENDAR_ID picks the calendar (default "primary", the token owner's).
 *
 * The event id is derived from the booking id (demoEventId), so creating the
 * same booking's event twice, from here or from the routine, is rejected by
 * Google with 409 instead of making a second event.
 */

export type GoogleCalendarEnv = Record<string, string | undefined>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type CalendarEventResult = {
  eventId: string;
  iCalUID: string;
  meetUrl: string;
  /** True when this booking's event already existed (409) and was read back. */
  existed: boolean;
};

export type DemoEventInput = {
  bookingId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  attendee: { email: string; name: string };
};

export type GoogleCalendarClient = {
  createDemoEvent(input: DemoEventInput): Promise<CalendarEventResult>;
};

/** Google event ids allow a–v and 0–9; a UUID's hex digits qualify. */
export function demoEventId(bookingId: string): string {
  const hex = bookingId.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length < 32) throw new Error('demoEventId: booking id is not a uuid');
  return `demo${hex}`;
}

export function calendarConfigured(env: GoogleCalendarEnv = process.env): boolean {
  return Boolean(
    env.GOOGLE_CALENDAR_CLIENT_ID?.trim() &&
      env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() &&
      env.GOOGLE_CALENDAR_REFRESH_TOKEN?.trim(),
  );
}

type GoogleEvent = {
  id?: string;
  iCalUID?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

function meetLink(event: GoogleEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  const url = video ?? event.hangoutLink ?? null;
  return url && /^https:\/\/meet\.google\.com\//.test(url) ? url : null;
}

export class CalendarHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createGoogleCalendarClient(options: {
  env?: GoogleCalendarEnv;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}): GoogleCalendarClient | null {
  const env = options.env ?? process.env;
  if (!calendarConfigured(env)) return null;
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID!.trim();
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET!.trim();
  const refreshToken = env.GOOGLE_CALENDAR_REFRESH_TOKEN!.trim();
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const calendarId = encodeURIComponent((env.GOOGLE_CALENDAR_ID || 'primary').trim());
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const res = await doFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    // Never echo the response body: it can carry token material.
    if (!res.ok) throw new CalendarHttpError(res.status, `google token ${res.status}`);
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
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
      throw new CalendarHttpError(res.status, `google calendar ${res.status}: ${detail}`);
    }
    return (await res.json()) as T;
  }

  const eventPath = (id: string) =>
    `/calendars/${calendarId}/events/${encodeURIComponent(id)}?conferenceDataVersion=1`;

  return {
    async createDemoEvent(input) {
      const id = demoEventId(input.bookingId);
      let event: GoogleEvent;
      let existed = false;
      try {
        event = await api<GoogleEvent>(
          `/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=none`,
          {
            method: 'POST',
            body: {
              id,
              summary: input.summary,
              description: input.description,
              start: { dateTime: input.start.toISOString() },
              end: { dateTime: input.end.toISOString() },
              attendees: [{ email: input.attendee.email, displayName: input.attendee.name }],
              guestsCanModify: false,
              guestsCanInviteOthers: false,
              reminders: { useDefault: true },
              conferenceData: {
                createRequest: { requestId: id, conferenceSolutionKey: { type: 'hangoutsMeet' } },
              },
            },
          },
        );
      } catch (err) {
        if (!(err instanceof CalendarHttpError) || err.status !== 409) throw err;
        // This booking's event already exists (retry, or the routine made it): reuse it.
        event = await api<GoogleEvent>(eventPath(id), { method: 'GET' });
        existed = true;
      }
      // Meet rooms are usually ready on create; when Google reports "pending", re-read briefly.
      for (let i = 0; !meetLink(event) && i < 3; i += 1) {
        if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') break;
        await sleep(1000);
        event = await api<GoogleEvent>(eventPath(id), { method: 'GET' });
      }
      const meetUrl = meetLink(event);
      if (!event.id || !meetUrl) throw new Error('google calendar: event has no Meet link');
      return { eventId: event.id, iCalUID: event.iCalUID || `${event.id}@google.com`, meetUrl, existed };
    },
  };
}
