import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { createAnonClient, createUserClient } from '../lib/supabase.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  setSessionCookies,
  clearSessionCookies,
  clearDeviceCookie,
} from '../lib/session.js';
import {
  credentialsSchema,
  signupCredentialsSchema,
  acceptTermsSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  internalStaffStartSchema,
  internalStaffVerifySchema,
} from '../lib/validation.js';
import { badRequest, unauthorized, HttpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { recordEvent } from '../lib/memory.js';
import {
  createPasswordAccount,
  publicUser,
  sessionTokens,
  signInPasswordAccount,
} from '../auth/passwordAccount.js';
import { sendPasswordReset } from '../auth/sendPasswordReset.js';
import { hasStaffName, resolveStaffNames, STAFF_LOGIN_DENIED } from '../lib/internalStaffGate.js';
import { resolvedAnalyticsScope, ensureAllowlistedAnalyticsAccess } from '../lib/analyticsAccess.js';
import { recordAccessRequest } from '../auth/internalAccessRequests.js';
import { openInternalStaffSession } from '../auth/internalStaffSession.js';
import { signStaffChallenge, readStaffChallenge } from '../lib/internalStaffChallenge.js';
import { otpauthUrl, randomTotpSecret, verifyTotp } from '../lib/totp.js';
import { loadEnrolledTotp, saveEnrolledTotp } from '../auth/internalStaffTotpStore.js';
import { toDataURL as totpQrDataUrl } from 'qrcode';
import { CURRENT_TERMS_VERSION, TERMS_PUBLIC_URL, clientIp, clientUserAgent } from '../legal/terms.js';
import { loadTermsStatus, recordTermsAcceptance, requireAcceptedTermsVersion } from '../legal/termsStore.js';

export const authRouter = Router();

/**
 * Rate limiter for authentication endpoints to blunt credential-stuffing and
 * brute-force attempts. Production stays tight; development is generous so
 * local / preview iteration is not blocked by our own limiter (Supabase may
 * still rate-limit independently).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isProduction ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many attempts. Please wait a few minutes and try again.',
      code: 'rate_limited',
    });
  },
});

/**
 * POST /api/auth/signup
 * Creates a new account for any valid email + password.
 *
 * Returns session tokens in the JSON body for native clients (Field Capture
 * stores them in Keychain). The dashboard also receives httpOnly cookies.
 *
 * Development / preview: prefers admin.createUser (service role) so signup
 * works for arbitrary emails without burning Supabase's built-in email quota.
 * Production: uses the public Auth signup path (confirmation emails as configured).
 */
authRouter.post('/signup', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, acceptedTermsVersion } = signupCredentialsSchema.parse(req.body);
    requireAcceptedTermsVersion(acceptedTermsVersion);
    const result = await createPasswordAccount(email, password);

    if (result.kind === 'error') throw result.error;

    if (result.kind === 'confirm') {
      if (result.user?.id) {
        await recordTermsAcceptance({
          userId: result.user.id,
          termsVersion: acceptedTermsVersion,
          ip: clientIp(req),
          userAgent: clientUserAgent(req),
        });
      }
      res.status(201).json({
        user: result.user ? publicUser(result.user) : null,
        needsEmailConfirmation: true,
        message: result.message,
        terms: result.user
          ? await loadTermsStatus(result.user.id)
          : {
              required: true,
              currentVersion: CURRENT_TERMS_VERSION,
              acceptedVersion: null,
              acceptedAt: null,
              url: TERMS_PUBLIC_URL,
            },
      });
      return;
    }

    const terms = await recordTermsAcceptance({
      userId: result.user.id,
      accessToken: result.session.access_token,
      termsVersion: acceptedTermsVersion,
      ip: clientIp(req),
      userAgent: clientUserAgent(req),
    });

    setSessionCookies(res, result.session);
    res.status(result.status).json({
      user: publicUser(result.user),
      needsEmailConfirmation: false,
      session: sessionTokens(result.session),
      terms,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Authenticates with email + password and sets httpOnly session cookies.
 */
authRouter.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const result = await signInPasswordAccount(email, password);
    if (result.kind === 'error') throw result.error;

    setSessionCookies(res, result.session);

    // Signing in is a real event with no row behind it, so the trigger that
    // records everything else cannot see it. Recorded here instead — and
    // deliberately awaited before responding, so a sign-in never lands in the
    // memory after the work that followed it.
    await recordEvent(createUserClient(result.session.access_token), {
      type: 'auth.signed_in',
      summary: 'signed in with a password',
      entityId: result.user.id,
    });

    const terms = await loadTermsStatus(result.user.id, result.session.access_token);
    res.json({
      user: publicUser(result.user),
      session: sessionTokens(result.session),
      terms,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/internal-challenge
 * Internal staff site step 1: name + approved email. Allowlisted or
 * admin-approved staff get a Microsoft Authenticator enrollment QR or a
 * prompt for the 6-digit code. Everyone else is queued for admin approval.
 */
authRouter.post('/internal-challenge', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = internalStaffStartSchema.parse(req.body);
    if (!unscopedAdminOrNull()) {
      throw new HttpError(
        503,
        'Staff sign-in is not configured on this server.',
        'internal_login_unavailable',
      );
    }
    const named = hasStaffName(body.firstName) && hasStaffName(body.lastName);
    if ((await resolvedAnalyticsScope(body.email)) === null) {
      if (!named) {
        res.json({ status: 'setup' });
        return;
      }
      const recorded = await recordAccessRequest({
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
      });
      if (recorded === 'pending') {
        res.json({ status: 'pending' });
        return;
      }
      throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
    }

    const enrolled = await loadEnrolledTotp(body.email);
    if (enrolled) {
      const names = resolveStaffNames(body, enrolled, body.email);
      const challenge = signStaffChallenge({
        email: body.email,
        firstName: names.firstName,
        lastName: names.lastName,
        enrolled: true,
      });
      res.json({ status: 'code', challenge });
      return;
    }

    if (!named) {
      res.json({ status: 'setup' });
      return;
    }

    const secret = randomTotpSecret();
    const otpauth = otpauthUrl(body.email, secret);
    const qrDataUrl = await totpQrDataUrl(otpauth, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
    const challenge = signStaffChallenge({
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      enrolled: false,
      secret,
    });
    res.json({
      status: 'enroll',
      challenge,
      otpauthUrl: otpauth,
      qrDataUrl,
      secret,
      issuer: 'Atmosphere Internal',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/internal-login
 * Internal staff site step 2: 6-digit code from Microsoft Authenticator.
 */
authRouter.post('/internal-login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = internalStaffVerifySchema.parse(req.body);
    let email: string;
    let firstName: string;
    let lastName: string;
    let secret: string;
    let minCounter = -1n;

    if (body.challenge) {
      const challenge = readStaffChallenge(body.challenge);
      if (!challenge || (await resolvedAnalyticsScope(challenge.email)) === null) {
        throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
      }
      email = challenge.email;
      firstName = challenge.firstName;
      lastName = challenge.lastName;
      if (challenge.enrolled) {
        const stored = await loadEnrolledTotp(challenge.email);
        if (!stored) throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
        secret = stored.secret;
        minCounter = stored.lastCounter;
        const names = resolveStaffNames(challenge, stored, challenge.email);
        firstName = names.firstName;
        lastName = names.lastName;
      } else if (challenge.secret) {
        secret = challenge.secret;
      } else {
        throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
      }
    } else if (body.email) {
      if ((await resolvedAnalyticsScope(body.email)) === null) {
        throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
      }
      const stored = await loadEnrolledTotp(body.email);
      if (!stored) throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
      email = body.email;
      secret = stored.secret;
      minCounter = stored.lastCounter;
      const names = resolveStaffNames({}, stored, body.email);
      firstName = names.firstName;
      lastName = names.lastName;
    } else {
      throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
    }

    const verified = verifyTotp(secret, body.code, { minCounter });
    if (!verified.ok) {
      throw unauthorized(STAFF_LOGIN_DENIED, 'internal_login_denied');
    }

    try {
      await saveEnrolledTotp(email, secret, verified.counter, { firstName, lastName });
    } catch {
      throw new HttpError(
        503,
        'Staff authenticator is not configured on this server.',
        'internal_totp_unavailable',
      );
    }

    const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
    const { user, session } = await openInternalStaffSession({
      email,
      firstName,
      lastName,
      fullName,
    });

    setSessionCookies(res, session);
    await ensureAllowlistedAnalyticsAccess(user, fullName);
    await recordEvent(createUserClient(session.access_token), {
      type: 'auth.signed_in',
      summary: 'signed in to the internal site with Microsoft Authenticator',
      entityId: user.id,
    });

    res.json({ user: publicUser(user), session: sessionTokens(session) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Revokes this session's refresh token server-side (best-effort) and clears
 * cookies. Gated on the refresh token alone so revocation still happens after
 * the short-lived access-token cookie has expired.
 */
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken =
      (req.cookies?.[config.cookies.refreshTokenName] as string | undefined) ||
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);

    if (refreshToken) {
      const supabase = createAnonClient();
      // Load the session from the refresh token (works even if the access-token
      // cookie is gone). This also rotates/consumes the old refresh token.
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session) {
        // Recorded while the session is still valid — after signOut there is no
        // identity left to attribute it to.
        await recordEvent(createUserClient(data.session.access_token), {
          type: 'auth.signed_out',
          summary: 'signed out',
          entityId: data.session.user.id,
        });
        // scope: 'local' revokes ONLY the current session, leaving the user's
        // other devices signed in.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
    }

    clearSessionCookies(res);
    res.json({ ok: true });
  } catch (err) {
    // Even if revocation fails, ensure cookies are cleared.
    clearSessionCookies(res);
    next(err);
  }
});

/**
 * POST /api/auth/refresh
 * Exchanges the refresh token cookie (or JSON body for native apps) for a
 * fresh session.
 */
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken =
      (req.cookies?.[config.cookies.refreshTokenName] as string | undefined) ||
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);
    if (!refreshToken) throw badRequest('No refresh token', 'no_refresh_token');

    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) {
      clearSessionCookies(res);
      throw unauthorized('Session expired. Please sign in again.', 'session_expired');
    }

    setSessionCookies(res, data.session);
    res.json({ user: publicUser(data.user), session: sessionTokens(data.session) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (or 401). Protected by requireAuth,
 * which also transparently refreshes an expired access token.
 */
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const terms = await loadTermsStatus(req.user!.id, req.accessToken);
    res.json({ user: publicUser(req.user!), terms });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/terms
 * Public: the live terms version and URL so clients can render the checkbox
 * before a session exists.
 */
authRouter.get('/terms', (_req: Request, res: Response) => {
  res.json({
    currentVersion: CURRENT_TERMS_VERSION,
    url: TERMS_PUBLIC_URL,
  });
});

/**
 * POST /api/auth/terms/accept
 * Record that this signed-in user acknowledged the live terms version.
 */
authRouter.post(
  '/terms/accept',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { acceptedTermsVersion } = acceptTermsSchema.parse(req.body);
      const terms = await recordTermsAcceptance({
        userId: req.user!.id,
        accessToken: req.accessToken,
        termsVersion: acceptedTermsVersion,
        ip: clientIp(req),
        userAgent: clientUserAgent(req),
      });
      res.json({ terms });
    } catch (err) {
      next(err);
    }
  },
);

/* ========================================================================== *
 * Password recovery
 * ========================================================================== */

/**
 * Recovery is rate limited far more tightly than login: these endpoints send
 * email and mutate credentials, so a generous budget would turn them into a
 * spam relay and a reset-token grinder respectively.
 */
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many password reset requests. Please wait an hour and try again.',
      code: 'rate_limited',
    });
  },
});

/**
 * POST /api/auth/forgot-password
 * Emails an Atmosphere-branded recovery link (platform SMTP / Resend).
 * Atmosphere mints a token_hash so the click opens the live office
 * /reset-password page — not Supabase Auth and not Site URL (localhost:3000).
 * Always answers with the same body whether or not the address is registered.
 */
authRouter.post(
  '/forgot-password',
  recoveryLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      await sendPasswordReset(email);

      res.json({
        ok: true,
        message: 'If an account exists for that address, a reset link is on its way.',
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/reset-password
 * Consumes the recovery credential from the email link and sets a new password.
 *
 * The exchange happens here rather than in the browser on purpose: this app
 * keeps Supabase tokens in httpOnly cookies, and the usual client-side recovery
 * pattern would expose an access token to page JavaScript, undoing that.
 */
authRouter.post(
  '/reset-password',
  recoveryLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tokenHash, code, accessToken, refreshToken, password } = resetPasswordSchema.parse(
        req.body,
      );
      const supabase = createAnonClient();

      // Recovery links arrive in three shapes depending on the email template
      // and flow type. Normalise them all into a session here.
      const exchange = tokenHash
        ? await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
        : code
          ? await supabase.auth.exchangeCodeForSession(code)
          : await supabase.auth.setSession({
              access_token: accessToken!,
              refresh_token: refreshToken!,
            });

      if (exchange.error || !exchange.data.session || !exchange.data.user) {
        throw unauthorized(
          'This reset link is invalid or has expired. Request a new one.',
          'invalid_reset_link',
        );
      }

      const { session } = exchange.data;

      // The recovery session authorises exactly one privileged action: changing
      // the password.
      const { data: updated, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError || !updated.user) {
        const status = updateError?.status === 422 ? 400 : 500;
        throw new HttpError(
          status,
          status === 400
            ? 'That password was rejected. Choose a different one.'
            : 'Could not update your password. Please try again.',
          'password_update_failed',
        );
      }

      // A password reset is the standard response to a suspected compromise, so
      // other devices' sessions must go.
      // Best effort: the password change itself has already succeeded, so a
      // failure to clean up must not turn into an error the user sees.
      try {
        const userClient = createUserClient(session.access_token);
        await userClient.rpc('revoke_my_devices');
      } catch {
        /* ignored */
      }
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);

      clearDeviceCookie(res);
      setSessionCookies(res, session);

      await recordEvent(createUserClient(session.access_token), {
        type: 'auth.password_reset',
        summary: 'reset their password, signing out other sessions',
        entityId: updated.user.id,
      });

      res.json({ user: publicUser(updated.user) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Changing a password from Settings requires the current one, so this endpoint
 * is also a password oracle for whoever is sitting at the browser. Cap the
 * guesses well below what a search would need, but leave enough room for a user
 * who simply mistypes.
 */
const changePasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many password change attempts. Please wait an hour and try again.',
      code: 'rate_limited',
    });
  },
});

/**
 * POST /api/auth/change-password
 * Changes the password of a signed-in user who can still supply the old one.
 *
 * Re-authenticating with the current password is deliberate: `requireAuth` only
 * proves the browser holds a session cookie, and a session that has been left
 * open should not be enough to lock the real owner out of their account.
 */
authRouter.post(
  '/change-password',
  changePasswordLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

      const email = req.user!.email;
      if (!email) {
        throw new HttpError(
          400,
          'This account has no email address, so its password cannot be changed here.',
          'no_email',
        );
      }

      // Verify the current password by signing in with it. The session this
      // mints is also what authorises the update below, so the change is scoped
      // to a caller who proved knowledge of the credential — not merely to
      // whoever holds the cookie.
      const supabase = createAnonClient();
      const { data: verified, error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (verifyError || !verified.session) {
        throw unauthorized('Your current password is incorrect.', 'invalid_credentials');
      }

      const { data: updated, error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError || !updated.user) {
        const status = updateError?.status === 422 ? 400 : 500;
        throw new HttpError(
          status,
          status === 400
            ? 'That password was rejected. Choose a different one.'
            : 'Could not update your password. Please try again.',
          'password_update_failed',
        );
      }

      // Retire every other session: anyone still signed in elsewhere with the
      // old password loses access, which is the point of changing it. This
      // device keeps its session.
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);

      setSessionCookies(res, verified.session);
      res.json({ user: publicUser(updated.user) });
    } catch (err) {
      next(err);
    }
  },
);
