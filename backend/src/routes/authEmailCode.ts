import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { clientIpKeyGenerator } from '../lib/clientIp.js';
import { config } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { setSessionCookies } from '../lib/session.js';
import { recordEvent } from '../lib/memory.js';
import { publicUser, sessionTokens } from '../auth/passwordAccount.js';
import { sendEmailSignInCode, verifyEmailSignInCode } from '../auth/emailCodeSignIn.js';
import { loadTermsStatus } from '../legal/termsStore.js';

/**
 * Email code sign-in: POST /email-code/start mails a 6-digit code to an
 * existing account, POST /email-code/verify trades it for the same session
 * a password sign-in returns. Mounted under /api/auth.
 */
export const emailCodeAuthRouter = Router();

const limiter = (max: number) =>
  rateLimit({
    keyGenerator: clientIpKeyGenerator,
    windowMs: 15 * 60 * 1000,
    max: config.isProduction ? max : max * 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.', code: 'rate_limited' });
    },
  });

const emailField = z.string({ required_error: 'Enter your email.' }).trim().toLowerCase().email('Enter a valid email.');
const startSchema = z.object({ email: emailField });
const verifySchema = z.object({
  email: emailField,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

emailCodeAuthRouter.post('/email-code/start', limiter(10), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = startSchema.parse(req.body ?? {});
    await sendEmailSignInCode(email);
    res.json({ ok: true, email });
  } catch (err) {
    next(err);
  }
});

emailCodeAuthRouter.post('/email-code/verify', limiter(20), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, code } = verifySchema.parse(req.body ?? {});
    const { session, user } = await verifyEmailSignInCode(email, code);
    const terms = await loadTermsStatus(user.id, session.access_token);
    setSessionCookies(res, session, req.hostname);
    await recordEvent(createUserClient(session.access_token), {
      type: 'auth.signed_in',
      summary: 'signed in with an email code',
      entityId: user.id,
    });
    res.json({ user: publicUser(user), session: sessionTokens(session), terms });
  } catch (err) {
    next(err);
  }
});
