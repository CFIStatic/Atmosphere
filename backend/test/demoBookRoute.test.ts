import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { demoRouter, setDemoStoreForTests } from '../src/routes/demo.js';
import type { DemoBookingStore } from '../src/lib/demoBookingService.js';

/** POST /api/demo/book reports emailed truthfully, through the real sendSystemMail. */

function memStore(): DemoBookingStore & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    async bookedBetween() {
      return rows.map((r) => String(r.slot_start));
    },
    async insert(row) {
      if (rows.some((r) => r.slot_start === row.slot_start)) return 'taken';
      const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`;
      rows.push({ ...row, id });
      return { id };
    },
    async markEmailed(id, field) {
      const r = rows.find((x) => x.id === id);
      if (r) r[field] = 'now';
    },
    async get() {
      return null;
    },
    async setMeet() {},
    async claimHostNotified() {
      return false;
    },
    async releaseHostNotified() {},
  };
}

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

test('POST /api/demo/book: emailed is false when mail is not configured, true once it is accepted', async () => {
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
      assert.ok(slots.slots.length >= 2);

      process.env.SYSTEM_MAIL_DRIVER = 'off';
      const off = await book(url, slots.slots[0]!, 'route-off@example.com');
      assert.equal(off.status, 200);
      assert.deepEqual([off.body.ok, off.body.emailed], [true, false]);
      assert.equal(store.rows.length, 1, 'slot held even though nothing was sent');

      // Dev log sink: the same path prod uses (sendSystemMail), written to a temp dir.
      const dir = await mkdtemp(path.join(tmpdir(), 'demo-mail-'));
      process.chdir(dir);
      process.env.SYSTEM_MAIL_DRIVER = 'log';
      const on = await book(url, slots.slots[1]!, 'route-on@example.com');
      assert.deepEqual([on.status, on.body.ok, on.body.emailed], [200, true, true]);
      const files = await readdir(path.join(dir, '.mail'));
      const txt = files.find((f) => f.endsWith('.txt'));
      assert.ok(txt, 'confirmation written');
      const mail = await readFile(path.join(dir, '.mail', txt!), 'utf8');
      assert.match(mail, /To: route-on@example\.com/);
      assert.match(mail, /Subject: Your Atmosphere demo is confirmed: /);
      assert.ok(!/meet\.google\.com/.test(mail));
    });
  } finally {
    setDemoStoreForTests(null);
    process.chdir(saved.cwd);
    if (saved.driver === undefined) delete process.env.SYSTEM_MAIL_DRIVER;
    else process.env.SYSTEM_MAIL_DRIVER = saved.driver;
    if (saved.resend !== undefined) process.env.RESEND_API_KEY = saved.resend;
  }
});
