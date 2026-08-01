import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { contactMessageSchema } from '../lib/validation.js';
import { contactMailConfigured, sendContactEmail } from '../lib/contactMail.js';
import { HttpError } from '../lib/errors.js';

/**
 * The corporate site's contact form posts here. Public by design, with the
 * same shape as the careers route: strict validation, a honeypot, and a
 * human-paced rate limit.
 */
export const contactRouter = Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'That looks like a lot of messages from one place. Try again in an hour.',
      code: 'rate_limited',
    });
  },
});

/**
 * POST /api/contact/send
 * Validate the message and email it to the sales inbox. Nothing is persisted
 * server-side — the inbox is the system of record.
 */
contactRouter.post(
  '/send',
  sendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const message = contactMessageSchema.parse(req.body);

      // Honeypot tripped: accept and discard so the bot learns nothing.
      if (message.website !== '') {
        res.json({ ok: true });
        return;
      }

      if (!contactMailConfigured()) {
        if (config.isProduction) {
          throw new HttpError(
            503,
            'The contact inbox is not set up yet — email us instead.',
            'contact_mail_unconfigured',
          );
        }
        console.log(
          `[contact] message (mail not configured, not sent) → ${config.contact.toEmail}:`,
          { name: message.name, email: message.email, company: message.company },
        );
        res.json({ ok: true, delivered: false });
        return;
      }

      await sendContactEmail(message);
      res.json({ ok: true, delivered: true });
    } catch (err) {
      next(err);
    }
  },
);
