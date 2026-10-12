import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { clientIp, clientIpKeyGenerator } from '../lib/clientIp.js';
import { demoBookingSchema, DEMO_SLOT_MINUTES, DEMO_TIME_ZONE } from '../lib/demoBooking.js';
import { bookDemo, openDemoSlots, supabaseDemoStore, type DemoBookingStore } from '../lib/demoBookingService.js';
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
