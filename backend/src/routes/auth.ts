import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { createAnonClient, createUserClient, createAdminClient } from '../lib/supabase.js';
import {
  setSessionCookies,
  clearSessionCookies,
  setDeviceCookie,
  clearDeviceCookie,
} from '../lib/session.js';
import {
  credentialsSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  pinSchema,
  pinUnlockSchema,
} from '../lib/validation.js';
import { badRequest, unauthorized, serviceUnavailable, HttpError } from '../lib/errors.js';
import { isTransient } from '../lib/upstream.js';
import {
  newDeviceSecret,
  newPinSalt,
  hashPin,
  hashDeviceSecret,
  encodeDeviceCookie,
  parseDeviceCookie,
} from '../lib/deviceCrypto.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { recordEvent } from '../lib/memory.js';
import { createPasswordAccount, publicUser, sessionTokens } from '../auth/passwordAccount.js';

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
    const { email, password } = credentialsSchema.parse(req.body);
    const result = await createPasswordAccount(email, password);

    if (result.kind === 'error') throw result.error;

    if (result.kind === 'confirm') {
      res.status(201).json({
        user: result.user ? publicUser(result.user) : null,
        needsEmailConfirmation: true,
        message: result.message,
      });
      return;
    }

    setSessionCookies(res, result.session);
    res.status(result.status).json({
      user: publicUser(result.user),
      needsEmailConfirmation: false,
      session: sessionTokens(result.session),
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
    const supabase = createAnonClient();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    // An unreachable or failing auth service is NOT a credential problem. Saying
    // "invalid email or password" during an outage sends users off resetting a
    // password that was never wrong, and buries the real incident.
    if (error && isTransient(error)) {
      console.warn('[login] upstream failure:', error.status, error.message);
      throw serviceUnavailable();
    }

    if (error || !data.session || !data.user) {
      // Genuine rejection. Do not reveal whether the email exists.
      throw unauthorized('Invalid email or password', 'invalid_credentials');
    }

    setSessionCookies(res, data.session);

    // Signing in is a real event with no row behind it, so the trigger that
    // records everything else cannot see it. Recorded here instead — and
    // deliberately awaited before responding, so a sign-in never lands in the
    // memory after the work that followed it.
    await recordEvent(createUserClient(data.session.access_token), {
      type: 'auth.signed_in',
      summary: 'signed in with a password',
      entityId: data.user.id,
    });

    res.json({ user: publicUser(data.user), session: sessionTokens(data.session) });
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
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: publicUser(req.user!) });
});

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
 * Sends a recovery email. Always answers with the same body whether or not the
 * address is registered — anything else turns this into an oracle for
 * enumerating which of a company's emails have accounts.
 */
authRouter.post(
  '/forgot-password',
  recoveryLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const supabase = createAnonClient();

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: config.passwordResetRedirectUrl,
      });

      if (error) {
        // Logged for operators, never surfaced to the caller.

        console.warn('[forgot-password] supabase error:', error.status, error.message);
      }

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
      // everything the old password could still reach has to go: other devices'
      // sessions, and every enrolled PIN.
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
        summary: 'reset their password, signing out other sessions and revoking every PIN',
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
      // device keeps its session (and its PIN — the user knows their password
      // here, so there is nothing to distrust about this browser).
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);

      setSessionCookies(res, verified.session);
      res.json({ user: publicUser(updated.user) });
    } catch (err) {
      next(err);
    }
  },
);

/* ========================================================================== *
 * Device-bound PIN unlock
 * ========================================================================== */

/**
 * A 4-digit PIN is only safe because it is bound to one device and throttled.
 * The authoritative limit is the per-device lockout in the database, which caps
 * a stolen device at 15 guesses ever (5 tries × 3 lockouts, then the enrollment
 * is destroyed). This IP limiter is only a coarse anti-spam layer, so it is set
 * well above real usage: a whole crew shares one NAT address in the field, and
 * throttling them off their own app would be a worse failure than the abuse it
 * prevents.
 */
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many PIN attempts. Please wait a few minutes or sign in with your password.',
      code: 'rate_limited',
    });
  },
});

interface DeviceLookupRow {
  pin_salt: string;
  locked_until: string | null;
}

interface DeviceVerifyRow {
  ok: boolean;
  user_id: string | null;
  locked_until: string | null;
  attempts_left: number;
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/** A coarse, non-identifying label so users can recognise a device in a list. */
function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS device';
  if (/Android/i.test(userAgent)) return 'Android device';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux device';
  return 'Unknown device';
}

/**
 * Mints a session for a user who proved possession of an enrolled device plus
 * the matching PIN. Uses the service role to generate a one-time link and
 * immediately redeems it, so no long-lived token is ever stored at rest.
 */
async function mintSessionForUser(userId: string) {
  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(503, 'PIN sign-in is not configured on this server.', 'pin_unavailable');
  }

  const { data: found, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError || !found.user?.email) {
    throw unauthorized('This device is no longer valid. Sign in with your password.', 'pin_stale');
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: found.user.email,
  });
  const hashedToken = link?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    throw new HttpError(
      503,
      'Could not complete PIN sign-in. Please try again.',
      'pin_mint_failed',
    );
  }

  const anon = createAnonClient();
  const { data: redeemed, error: redeemError } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
  });
  if (redeemError || !redeemed.session || !redeemed.user) {
    throw new HttpError(
      503,
      'Could not complete PIN sign-in. Please try again.',
      'pin_mint_failed',
    );
  }

  return { session: redeemed.session, user: redeemed.user };
}

/**
 * GET /api/auth/pin/status
 * Tells the login page whether to open on the PIN pad or the password form.
 * Reports "not enrolled" when the server cannot actually complete a PIN sign-in,
 * so the UI never offers a button that is guaranteed to fail.
 */
authRouter.get('/pin/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseDeviceCookie(req.cookies?.[config.device.cookieName] as string | undefined);
    if (!parsed || !createAdminClient()) {
      res.json({ enrolled: false });
      return;
    }

    const supabase = createAnonClient();
    const { data, error } = await supabase.rpc('device_lookup', {
      p_device_id: parsed.deviceId,
      p_secret_hash: hashDeviceSecret(parsed.secret),
    });

    const row = firstRow<DeviceLookupRow>(data);
    if (error || !row) {
      // The enrollment was revoked elsewhere — drop the stale cookie.
      clearDeviceCookie(res);
      res.json({ enrolled: false });
      return;
    }

    const lockedUntil =
      row.locked_until && new Date(row.locked_until) > new Date() ? row.locked_until : null;
    res.json({ enrolled: true, lockedUntil });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/pin/enroll
 * Sets a PIN for the current device. Requires a live session, which is what
 * makes the PIN a second factor for *this* device rather than a credential in
 * its own right.
 */
authRouter.post(
  '/pin/enroll',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pin } = pinSchema.parse(req.body);

      // Refuse to enroll if unlock could never work — otherwise the user sets a
      // PIN, trusts it, and discovers at the next sign-in that it does nothing.
      if (!createAdminClient()) {
        throw new HttpError(
          503,
          'PIN sign-in is not configured on this server.',
          'pin_unavailable',
        );
      }

      const secret = newDeviceSecret();
      const salt = newPinSalt();

      // If this browser is already enrolled, this is a PIN *change* — hand the
      // old device id over so the previous PIN is retired instead of remaining
      // valid alongside the new one.
      const existing = parseDeviceCookie(
        req.cookies?.[config.device.cookieName] as string | undefined,
      );

      const supabase = createUserClient(req.accessToken!);
      const { data, error } = await supabase.rpc('enroll_device', {
        p_secret_hash: hashDeviceSecret(secret),
        p_pin_hash: hashPin(pin, salt),
        p_pin_salt: salt,
        p_label: deviceLabel(req.get('user-agent')),
        p_replace_device_id: existing?.deviceId ?? null,
      });

      if (error || !data) {
        throw new HttpError(500, 'Could not save your PIN. Please try again.', 'pin_enroll_failed');
      }

      setDeviceCookie(res, encodeDeviceCookie(String(data), secret));
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/pin/unlock
 * Exchanges a correct PIN on an enrolled device for a full session.
 */
authRouter.post(
  '/pin/unlock',
  pinLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pin } = pinUnlockSchema.parse(req.body);

      const parsed = parseDeviceCookie(
        req.cookies?.[config.device.cookieName] as string | undefined,
      );
      if (!parsed) {
        throw unauthorized('This device is not set up for PIN sign-in.', 'pin_not_enrolled');
      }

      const supabase = createAnonClient();
      const secretHash = hashDeviceSecret(parsed.secret);

      // Fetch the per-device salt so the PIN can be hashed the same way it was
      // stored. This returns nothing unless the device secret already matches.
      const { data: lookupData, error: lookupError } = await supabase.rpc('device_lookup', {
        p_device_id: parsed.deviceId,
        p_secret_hash: secretHash,
      });
      const lookup = firstRow<DeviceLookupRow>(lookupData);
      if (lookupError || !lookup) {
        clearDeviceCookie(res);
        throw unauthorized('This device is not set up for PIN sign-in.', 'pin_not_enrolled');
      }

      const { data: verifyData, error: verifyError } = await supabase.rpc('device_verify_pin', {
        p_device_id: parsed.deviceId,
        p_secret_hash: secretHash,
        p_pin_hash: hashPin(pin, lookup.pin_salt),
      });
      if (verifyError) {
        throw new HttpError(503, 'Could not verify your PIN. Please try again.', 'pin_unavailable');
      }

      const verify = firstRow<DeviceVerifyRow>(verifyData);

      if (!verify?.ok) {
        if (verify?.locked_until) {
          throw new HttpError(
            429,
            'Too many incorrect PINs. This device is locked for 15 minutes — sign in with your password instead.',
            'pin_locked',
          );
        }
        if (verify && verify.attempts_left > 0) {
          const left = verify.attempts_left;
          throw unauthorized(
            `Incorrect PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} remaining.`,
            'pin_invalid',
          );
        }
        // Repeated lockouts removed the enrollment entirely.
        clearDeviceCookie(res);
        throw unauthorized(
          'PIN sign-in has been disabled on this device. Please sign in with your password.',
          'pin_revoked',
        );
      }

      const { session, user } = await mintSessionForUser(verify.user_id!);
      setSessionCookies(res, session);

      await recordEvent(createUserClient(session.access_token), {
        type: 'auth.pin_unlocked',
        summary: 'signed in with a device PIN',
        entityId: user.id,
      });

      res.json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/pin/disable
 * Removes every PIN enrollment for the current user.
 */
authRouter.post(
  '/pin/disable',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);
      const { error } = await supabase.rpc('revoke_my_devices');
      if (error) {
        throw new HttpError(
          500,
          'Could not turn off PIN sign-in. Please try again.',
          'pin_disable_failed',
        );
      }
      clearDeviceCookie(res);

      await recordEvent(supabase, {
        type: 'auth.pin_disabled',
        summary: 'turned off PIN sign-in on every device',
        entityId: req.user!.id,
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
