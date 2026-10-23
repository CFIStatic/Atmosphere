import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { clientIpKeyGenerator } from '../lib/clientIp.js';
import { config } from '../config.js';
import { createAnonClient, createUserClient } from '../lib/supabase.js';
import { setSessionCookies } from '../lib/session.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { recordEvent } from '../lib/memory.js';
import { publicUser, sessionTokens } from '../auth/passwordAccount.js';
import { createOtpThrottle, effectivePhoneIntent, normalizePhoneE164, phoneAuthEnabled } from '../auth/phoneAuth.js';
import { clientIp, clientUserAgent } from '../legal/terms.js';
import { loadTermsStatus, recordTermsAcceptance, requireAcceptedTermsVersion } from '../legal/termsStore.js';

/**
 * Phone sign-in: POST /phone/start texts a 6-digit code, POST /phone/verify
 * trades it for the same session cookies a password sign-in sets.
 * Mounted under /api/auth.
 */
export const phoneAuthRouter = Router();

/** A live crew invite (org_invites, or a job party) for this E.164 number. */
async function hasPendingPhoneInvite(phone: string): Promise<boolean> {
  const admin = unscopedAdminOrNull();
  if (!admin) return false;
  const { data } = await admin
    .from('org_invites')
    .select('id')
    .eq('status', 'pending')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (data) return true;
  // Crew invited to one job by mobile number (Access tab → Invite).
  const { data: party } = await admin
    .from('job_parties')
    .select('id')
    .eq('phone', phone)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();
  return Boolean(party);
}

const sendThrottle = createOtpThrottle();

/** Per-IP: sending codes costs money, so tighter than password attempts. */
const startLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 15 * 60 * 1000,
  max: config.isProduction ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many codes requested. Please wait a few minutes.', code: 'rate_limited' });
  },
});

const verifyLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 15 * 60 * 1000,
  max: config.isProduction ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.', code: 'rate_limited' });
  },
});

const phoneField = z
  .string({ required_error: 'Enter your phone number.' })
  .trim()
  .transform((value, ctx) => {
    const e164 = normalizePhoneE164(value);
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number.' });
      return z.NEVER;
    }
    return e164;
  });

const startSchema = z.object({
  phone: phoneField,
  /** signup may create the account; signin only texts existing numbers. */
  intent: z.enum(['signin', 'signup']).default('signin'),
});

const verifySchema = z.object({
  phone: phoneField,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  acceptedTermsVersion: z.string().trim().min(1).optional(),
  voiceConsent: z.boolean().optional(),
});

function requireEnabled(): void {
  if (!phoneAuthEnabled()) {
    throw new HttpError(404, 'Phone sign-in is not available.', 'phone_auth_disabled');
  }
}

/** GET /api/auth/phone/config — whether to show "Use phone number instead". */
phoneAuthRouter.get('/phone/config', (_req: Request, res: Response) => {
  res.json({ enabled: phoneAuthEnabled() });
});

phoneAuthRouter.post('/phone/start', startLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireEnabled();
    const parsed = startSchema.parse(req.body ?? {});
    const phone = parsed.phone;
    let intent = parsed.intent;
    // New accounts by phone are for invited crew only. Anyone else signs up
    // with email; an existing phone account can always sign in.
    if (intent === 'signup') intent = effectivePhoneIntent(intent, await hasPendingPhoneInvite(phone));
    const verdict = sendThrottle.check(phone);
    if (!verdict.ok) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      throw new HttpError(
        429,
        `A code was just sent. You can request another in ${verdict.retryAfterSeconds} seconds.`,
        'otp_throttled',
      );
    }
    const { error } = await createAnonClient().auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: intent === 'signup', channel: 'sms' },
    });
    if (error) {
      if (/signups? not allowed|user not found/i.test(error.message)) {
        throw new HttpError(
          404,
          'This number has not been invited. Ask your Global Admin to invite it, or sign in with email.',
          'phone_not_invited',
        );
      }
      if (/rate limit|security purposes/i.test(error.message)) {
        throw new HttpError(429, 'Too many codes requested. Please wait a minute.', 'rate_limited');
      }
      console.warn('[phone-auth] send failed:', error.message);
      throw new HttpError(502, 'We could not text a code to that number. Check it and try again.', 'otp_send_failed');
    }
    sendThrottle.record(phone);
    res.json({ ok: true, phone });
  } catch (err) {
    next(err);
  }
});

phoneAuthRouter.post('/phone/verify', verifyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireEnabled();
    const { phone, code, acceptedTermsVersion, voiceConsent } = verifySchema.parse(req.body ?? {});
    const { data, error } = await createAnonClient().auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error || !data.session || !data.user) {
      throw new HttpError(401, 'That code is incorrect or expired. Request a new one.', 'otp_invalid');
    }
    const { session, user } = data;

    let terms;
    if (acceptedTermsVersion) {
      requireAcceptedTermsVersion(acceptedTermsVersion);
      terms = await recordTermsAcceptance({
        userId: user.id,
        accessToken: session.access_token,
        termsVersion: acceptedTermsVersion,
        voiceConsent,
        ip: clientIp(req),
        userAgent: clientUserAgent(req),
      });
    } else {
      terms = await loadTermsStatus(user.id, session.access_token);
    }

    setSessionCookies(res, session, req.hostname);
    await recordEvent(createUserClient(session.access_token), {
      type: 'auth.signed_in',
      summary: 'signed in with a text message code',
      entityId: user.id,
    });
    res.json({ user: publicUser(user), session: sessionTokens(session), terms });
  } catch (err) {
    next(err);
  }
});
