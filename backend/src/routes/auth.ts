import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import type { User } from '@supabase/supabase-js';
import { createAnonClient } from '../lib/supabase.js';
import { setSessionCookies, clearSessionCookies } from '../lib/session.js';
import { credentialsSchema } from '../lib/validation.js';
import { badRequest, unauthorized, HttpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

/**
 * Rate limiter for authentication endpoints to blunt credential-stuffing and
 * brute-force attempts: max 20 attempts / 15 min per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many attempts. Please wait a few minutes and try again.',
      code: 'rate_limited',
    });
  },
});

/** Only expose non-sensitive fields of the Supabase user to the client. */
function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
    metadata: user.user_metadata ?? {},
  };
}

/**
 * POST /api/auth/signup
 * Creates a new account. Depending on the project's email-confirmation setting,
 * Supabase either returns an active session (auto-confirm on) or requires the
 * user to confirm via email first (no session returned).
 */
authRouter.post('/signup', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const supabase = createAnonClient();

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      // Surface Supabase's message but normalise the status code.
      throw new HttpError(error.status && error.status >= 400 ? error.status : 400, error.message, 'signup_failed');
    }

    if (data.session) {
      setSessionCookies(res, data.session);
      res.status(201).json({ user: data.user ? publicUser(data.user) : null, needsEmailConfirmation: false });
      return;
    }

    // No session => email confirmation required before the user can sign in.
    res.status(201).json({
      user: data.user ? publicUser(data.user) : null,
      needsEmailConfirmation: true,
      message: 'Account created. Check your email to confirm before signing in.',
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
    if (error || !data.session || !data.user) {
      // Do not reveal whether the email exists — generic message.
      throw unauthorized('Invalid email or password', 'invalid_credentials');
    }

    setSessionCookies(res, data.session);
    res.json({ user: publicUser(data.user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Revokes the refresh token server-side (best-effort) and clears cookies.
 */
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accessToken = req.cookies?.cx_access_token as string | undefined;
    const refreshToken = req.cookies?.cx_refresh_token as string | undefined;

    if (accessToken && refreshToken) {
      const supabase = createAnonClient();
      // Restore the session on this stateless client, then sign out to revoke it.
      const { error: setErr } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!setErr) {
        await supabase.auth.signOut().catch(() => undefined);
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
 * Exchanges the refresh token cookie for a fresh session.
 */
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.cx_refresh_token as string | undefined;
    if (!refreshToken) throw badRequest('No refresh token', 'no_refresh_token');

    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) {
      clearSessionCookies(res);
      throw unauthorized('Session expired. Please sign in again.', 'session_expired');
    }

    setSessionCookies(res, data.session);
    res.json({ user: publicUser(data.user) });
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
