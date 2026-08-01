import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { careersApplicationSchema } from '../lib/validation.js';
import { careersMailConfigured, sendApplicationEmail } from '../lib/careersMail.js';
import { HttpError } from '../lib/errors.js';

/**
 * The corporate site's careers form posts here. Public by design — applicants
 * don't have accounts — so the surface is kept to one narrow POST with strict
 * validation, a honeypot, and a tight rate limit.
 */
export const careersRouter = Router();

/**
 * Applications are human-paced: one person sends one, maybe fixes a typo and
 * sends again. Anything past a handful an hour from one address is a script.
 */
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'That looks like a lot of applications from one place. Try again in an hour.',
      code: 'rate_limited',
    });
  },
});

/**
 * POST /api/careers/apply
 * Validate the application and email it to the hiring inbox. Nothing is
 * persisted server-side — the inbox is the system of record for hiring.
 */
careersRouter.post(
  '/apply',
  applyLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const application = careersApplicationSchema.parse(req.body);

      // Honeypot tripped: a bot filled the invisible field. Accept and discard
      // so the script sees nothing worth adapting to.
      if (application.website !== '') {
        res.json({ ok: true });
        return;
      }

      if (!careersMailConfigured()) {
        if (config.isProduction) {
          throw new HttpError(
            503,
            'The applications inbox is not set up yet — email us instead.',
            'careers_mail_unconfigured',
          );
        }
        // Development without SMTP: log instead of sending, so the whole flow
        // is testable locally with nothing configured.
        console.log(
          `[careers] application (mail not configured, not sent) → ${config.careers.toEmail}:`,
          { name: application.name, email: application.email, role: application.role },
        );
        res.json({ ok: true, delivered: false });
        return;
      }

      await sendApplicationEmail(application);
      res.json({ ok: true, delivered: true });
    } catch (err) {
      next(err);
    }
  },
);
