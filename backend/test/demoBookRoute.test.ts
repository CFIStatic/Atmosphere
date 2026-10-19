import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { demoRouter, setDemoCalendarForTests, setDemoStoreForTests } from '../src/routes/demo.js';
import type { GoogleCalendarClient } from '../src/lib/googleCalendar.js';
import type { DemoBookingStore } from '../src/lib/demoBookingService.js';

/** POST /api/demo/book reports emailed truthfully, through the real sendSystemMail. */

function memStore(): DemoBookingStore & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const find = (id: string) => rows.find((x) => x.id === id)!;
  return {
    rows,
    async bookedBetween() {
      return rows.map((r) => String(r.slot_start));
    },
    async insert(row) {
      if (rows.some((r) => r.slot_start === row.slot_start)) return 'taken';
      const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`;
      rows.push({ host_notified_at: null, guest_emailed_at: null, google_event_id: null, meet_url: null, ...row, id });
      return { id };
    },
    async get(id) {
      return { ...find(id) } as never;
    },
    async setMeetOnce(id, meetUrl, eventId) {
      const r = find(id);
      if (!r.google_event_id) Object.assign(r, { meet_url: meetUrl, google_event_id: eventId });
      return { eventId: String(r.google_event_id), meetUrl: String(r.meet_url) };
    },
    async claim(id, field) {
      const r = find(id);
      if (r[field]) return false;
      r[field] = 'now';
      return true;
    },
    async release(id, field) {
      find(id)[field] = null;
    },
  };
}

const fakeCalendar: GoogleCalendarClient = {
  async createDemoEvent(input) {
    return { eventId: `demo${input.bookingId.replace(/-/g, '')}`, iCalUID: 'x@google.com', meetUrl: 'https://meet.google.com/abc-defg-hij', existed: false };
  },
};

async function withServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/demo', demoRouter);
  app.use((err: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  try {
    return await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function book(url: string, slotStart: string, email: string) {
  const res = await fetch(`${url}/api/demo/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotStart, name: 'Route Test', email, company: 'Example Co', timeZone: 'America/Chicago' }),
  });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; emailed?: boolean } };
}

test('POST /api/demo/book: emailed is false without a calendar event or without mail; true once the one email is accepted', async () => {
  const saved = {
    driver: process.env.SYSTEM_MAIL_DRIVER,
    resend: process.env.RESEND_API_KEY,
    cwd: process.cwd(),
  };
  delete process.env.RESEND_API_KEY;
  const store = memStore();
  setDemoStoreForTests(store);
  try {
    await withServer(async (url) => {
      const slots = (await (await fetch(`${url}/api/demo/slots`)).json()) as { slots: string[] };
      assert.ok(slots.slots.length >= 3);

      // No calendar configured: slot held, nothing sent yet (routine + meet hook send it).
      setDemoCalendarForTests(null);
      process.env.SYSTEM_MAIL_DRIVER = 'log';
      const nocal = await book(url, slots.slots[2]!, 'route-nocal@example.com');
      assert.deepEqual([nocal.status, nocal.body.ok, nocal.body.emailed], [200, true, false]);

      setDemoCalendarForTests(fakeCalendar);
      process.env.SYSTEM_MAIL_DRIVER = 'off';
      const off = await book(url, slots.slots[0]!, 'route-off@example.com');
      assert.equal(off.status, 200);
      assert.deepEqual([off.body.ok, off.body.emailed], [true, false]);
      assert.equal(store.rows.length, 2, 'slots held even though nothing was sent');

      // Dev log sink: the same path prod uses (sendSystemMail), written to a temp dir.
      const dir = await mkdtemp(path.join(tmpdir(), 'demo-mail-'));
      process.chdir(dir);
      process.env.SYSTEM_MAIL_DRIVER = 'log';
      const on = await book(url, slots.slots[1]!, 'route-on@example.com');
      assert.deepEqual([on.status, on.body.ok, on.body.emailed], [200, true, true]);
      const files = (await readdir(path.join(dir, '.mail'))).filter((f) => f.endsWith('.txt'));
      const guest = files.filter((f) => f.includes('route-on@example.com'));
      assert.equal(guest.length, 1, 'exactly one guest email');
      const mail = await readFile(path.join(dir, '.mail', guest[0]!), 'utf8');
      assert.match(mail, /Subject: Your Atmosphere demo is confirmed: /);
      assert.match(mail, /Join with Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/);
      assert.equal(files.filter((f) => f.includes('route-nocal')).length, 0, 'no email without an event');
    });
  } finally {
    setDemoStoreForTests(null);
    setDemoCalendarForTests(undefined);
    process.chdir(saved.cwd);
    if (saved.driver === undefined) delete process.env.SYSTEM_MAIL_DRIVER;
    else process.env.SYSTEM_MAIL_DRIVER = saved.driver;
    if (saved.resend !== undefined) process.env.RESEND_API_KEY = saved.resend;
  }
});
