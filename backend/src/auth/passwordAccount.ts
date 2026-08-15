import type { Session, User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAdminClient, createAnonClient } from '../lib/supabase.js';
import { HttpError, serviceUnavailable } from '../lib/errors.js';
import { isTransient } from '../lib/upstream.js';

/**
 * Shared password-account creation for the website signup page and the
 * Field Capture iOS app. Both clients need the same Supabase user so a
 * crew member can create an account on the phone and later open the
 * dashboard with the same email and password.
 */

export function sessionTokens(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in ?? null,
    expiresAt: session.expires_at ?? null,
  };
}

/** Only expose non-sensitive fields of the Supabase user to the client. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
    metadata: user.user_metadata ?? {},
  };
}

export type PasswordAccountOk = {
  kind: 'session';
  status: 200 | 201;
  user: User;
  session: Session;
};

export type PasswordAccountConfirm = {
  kind: 'confirm';
  user: User | null;
  message: string;
};

export type PasswordAccountFail = {
  kind: 'error';
  error: HttpError;
};

export type PasswordAccountResult = PasswordAccountOk | PasswordAccountConfirm | PasswordAccountFail;

async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ user: User; session: Session } | null> {
  const supabase = createAnonClient();
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    if (signedIn.error) {
      console.warn('[signup] password sign-in failed:', signedIn.error.message);
    }
    return null;
  }
  return { user: signedIn.data.user, session: signedIn.data.session };
}

/**
 * Non-production path: create any email via the admin API with email already
 * confirmed. Avoids Supabase's built-in SMTP rate limit (~2 confirmation emails
 * / hour), which otherwise blocks "new user" signup during local/preview work.
 */
async function signupViaAdmin(
  email: string,
  password: string,
): Promise<PasswordAccountOk | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error) {
    console.warn('[signup] admin.createUser:', created.error.message);
    if (/already|registered|exists/i.test(created.error.message)) {
      const existing = await signInWithPassword(email, password);
      if (!existing) return null;
      return { kind: 'session', status: 200, user: existing.user, session: existing.session };
    }
    return null;
  }

  const signedIn = await signInWithPassword(email, password);
  if (!signedIn) return null;
  return { kind: 'session', status: 201, user: signedIn.user, session: signedIn.session };
}

/**
 * Create a password account (or sign in if that email already exists and the
 * password matches). Used by POST /api/auth/signup and the Field Capture
 * register route.
 */
export async function createPasswordAccount(
  email: string,
  password: string,
): Promise<PasswordAccountResult> {
  if (!config.isProduction) {
    const viaAdmin = await signupViaAdmin(email, password);
    if (viaAdmin) return viaAdmin;

    if (!createAdminClient()) {
      console.warn(
        '[signup] SUPABASE_SERVICE_ROLE_KEY is unset — public Auth signup will hit email rate limits. Set the service role key in backend/.env for unrestricted local signups.',
      );
    }
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error && isTransient(error)) {
    console.warn('[signup] upstream failure:', error.status, error.message);
    return { kind: 'error', error: serviceUnavailable() };
  }

  if (error) {
    console.warn('[signup] supabase error:', error.status, error.message);

    if (error.status === 429) {
      const viaAdmin = await signupViaAdmin(email, password);
      if (viaAdmin) return viaAdmin;
      return {
        kind: 'error',
        error: new HttpError(
          429,
          'Too many sign-up attempts right now. Set SUPABASE_SERVICE_ROLE_KEY on the BFF for unrestricted local signups, or wait a few minutes and try again.',
          'rate_limited',
        ),
      };
    }

    return {
      kind: 'error',
      error: new HttpError(
        400,
        'Unable to create an account with those details. If you already have an account, try signing in.',
        'signup_failed',
      ),
    };
  }

  if (data.session && data.user) {
    return { kind: 'session', status: 201, user: data.user, session: data.session };
  }

  if (!config.isProduction && data.user?.id) {
    const admin = createAdminClient();
    if (admin) {
      await admin.auth.admin.updateUserById(data.user.id, { email_confirm: true });
      const signedIn = await signInWithPassword(email, password);
      if (signedIn) {
        return { kind: 'session', status: 201, user: signedIn.user, session: signedIn.session };
      }
    }
  }

  return {
    kind: 'confirm',
    user: data.user ?? null,
    message: 'Account created. Check your email to confirm before signing in.',
  };
}
