import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { clientIp, clientIpKeyGenerator } from '../lib/clientIp.js';
import { demoBookingSchema, DEMO_SLOT_MINUTES, DEMO_TIME_ZONE } from '../lib/demoBooking.js';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { bookDemo, notifyHostWithMeet, openDemoSlots, supabaseDemoStore, type DemoBookingStore } from '../lib/demoBookingService.js';
import { unscopedAdmin } from '../lib/scopedAdmin.js';
import { sendSystemMail } from '../lib/systemMail.js';

/**
 * atmosphereteam.com/demo — public by design (like /api/contact): strict
 * validation, a honeypot, and a human-paced rate limit keyed on the real IP.
 */
export const demoRouter = Router();

let storeOverride: DemoBookingStore | null = null;
/** Tests only. */
export function setDemoStoreForTests(store: DemoBookingStore | null): void {
  storeOverride = store;
}
function store(): DemoBookingStore {
  return storeOverride ?? supabaseDemoStore(unscopedAdmin());
}

const slotsLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const bookLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'That looks like a lot of bookings from one place. Try again in an hour.',
      code: 'rate_limited',
    });
  },
});

/** GET /api/demo/slots — open 30-minute slot starts (UTC ISO). */
demoRouter.get('/slots', slotsLimiter, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const slots = await openDemoSlots(store());
    res.set('Cache-Control', 'no-store');
    res.json({ slots, minutes: DEMO_SLOT_MINUTES, hostTimeZone: DEMO_TIME_ZONE });
  } catch (err) {
    next(err);
  }
});

/** POST /api/demo/book — hold the slot and notify the host; the guest's invite comes from Google Calendar. */
demoRouter.post('/book', bookLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = demoBookingSchema.parse(req.body);
    // Honeypot tripped: accept and discard so the bot learns nothing.
    if (input.website !== '') {
      res.json({ ok: true, slotStart: input.slotStart });
      return;
    }
    const result = await bookDemo(input, { store: store(), send: sendSystemMail, ip: clientIp(req) });
    res.json({ ok: true, slotStart: result.slotStart, emailed: true });
  } catch (err) {
    next(err);
  }
});

const meetSchema = z.object({
  meetUrl: z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'meetUrl must be https'),
  eventId: z.string().trim().min(1).max(1024),
});

function secretOk(given: string | undefined): boolean {
  const want = (process.env.DEMO_MEET_WEBHOOK_SECRET || '').trim();
  if (want.length < 32 || !given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/demo/bookings/:id/meet — staff routine only (X-Demo-Meet-Secret).
 * Stores the booking's Google event + Meet link and sends the host ONE email
 * with a Join meeting button. Idempotent: a second call does not resend.
 */
demoRouter.post('/bookings/:id/meet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!secretOk(req.get('x-demo-meet-secret'))) {
      res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });
      return;
    }
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(404).json({ error: 'Booking not found.', code: 'not_found' });
      return;
    }
    const input = meetSchema.parse(req.body);
    const r = await notifyHostWithMeet(id, input, { store: store(), send: sendSystemMail });
    res.json({ ok: true, ...r });
  } catch (err) {
    next(err);
  }
});
