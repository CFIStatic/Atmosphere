import type { Session, User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAdminClient, createAnonClient } from '../lib/supabase.js';
import { HttpError, serviceUnavailable, unauthorized } from '../lib/errors.js';
import { isTransient } from '../lib/upstream.js';
import {
  classifyPasswordSignIn,
  EMAIL_UNCONFIRMED_MESSAGE,
  EXISTING_ACCOUNT_MESSAGE,
  isObfuscatedExistingUser,
  isUserAlreadyRegistered,
} from './passwordErrors.js';

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

async function rawSignIn(
  email: string,
  password: string,
): Promise<{
  user: User | null;
  session: Session | null;
  error: { message?: string; code?: string; status?: number; name?: string } | null;
}> {
  const supabase = createAnonClient();
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  return {
    user: signedIn.data.user ?? null,
    session: signedIn.data.session ?? null,
    error: signedIn.error,
  };
}

/**
 * Look up an auth user by email without sending mail. Admin generateLink
 * returns the user row and does not deliver the link.
 */
async function lookupUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  for (const type of ['magiclink', 'recovery'] as const) {
    const generated = await admin.auth.admin.generateLink({ type, email });
    const id = generated.data?.user?.id;
    if (id) return id;
  }
  return null;
}

async function confirmEmail(email: string, userId?: string | null): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const id = userId || (await lookupUserIdByEmail(email));
  if (!id) return false;
  const updated = await admin.auth.admin.updateUserById(id, { email_confirm: true });
  if (updated.error) {
    console.warn('[auth] confirmEmail failed:', updated.error.message);
    return false;
  }
  return true;
}

async function sessionAfterSignIn(
  email: string,
  password: string,
): Promise<{ user: User; session: Session } | null> {
  const signedIn = await rawSignIn(email, password);
  if (signedIn.session && signedIn.user) {
    return { user: signedIn.user, session: signedIn.session };
  }
  return null;
}

/**
 * Sign in with email + password. If the password is correct but the address
 * was never confirmed, confirm it (service role) and retry — that is the
 * "account exists, login says wrong password" trap.
 */
export async function signInPasswordAccount(
  email: string,
  password: string,
): Promise<PasswordAccountOk | PasswordAccountFail> {
  const first = await rawSignIn(email, password);
  const kind = classifyPasswordSignIn({
    error: first.error,
    hasSession: Boolean(first.session),
    hasUser: Boolean(first.user),
    transient: Boolean(first.error && isTransient(first.error)),
  });

  if (kind === 'session' && first.session && first.user) {
    return { kind: 'session', status: 200, user: first.user, session: first.session };
  }

  if (kind === 'transient') {
    console.warn('[login] upstream failure:', first.error?.status, first.error?.message);
    return { kind: 'error', error: serviceUnavailable() };
  }

  if (kind === 'email_not_confirmed') {
    const confirmed = await confirmEmail(email, first.user?.id);
    if (confirmed) {
      const retried = await sessionAfterSignIn(email, password);
      if (retried) {
        return { kind: 'session', status: 200, user: retried.user, session: retried.session };
      }
    }
    return {
      kind: 'error',
      error: unauthorized(EMAIL_UNCONFIRMED_MESSAGE, 'email_not_confirmed'),
    };
  }

  return {
    kind: 'error',
    error: unauthorized('Invalid email or password', 'invalid_credentials'),
  };
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
      const existing = await signInPasswordAccount(email, password);
      if (existing.kind !== 'session') return null;
      return existing;
    }
    return null;
  }

  const signedIn = await sessionAfterSignIn(email, password);
  if (!signedIn) return null;
  return { kind: 'session', status: 201, user: signedIn.user, session: signedIn.session };
}

async function signInExistingAccount(
  email: string,
  password: string,
): Promise<PasswordAccountResult> {
  const signedIn = await signInPasswordAccount(email, password);
  if (signedIn.kind === 'session') return signedIn;
  if (signedIn.error.code === 'email_not_confirmed') return signedIn;
  return {
    kind: 'error',
    error: new HttpError(400, EXISTING_ACCOUNT_MESSAGE, 'account_exists'),
  };
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

    if (isUserAlreadyRegistered(error)) {
      return signInExistingAccount(email, password);
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

  if (isObfuscatedExistingUser(data.user, data.session)) {
    return signInExistingAccount(email, password);
  }

  if (data.session && data.user) {
    return { kind: 'session', status: 201, user: data.user, session: data.session };
  }

  if (data.user?.id) {
    const confirmed = await confirmEmail(email, data.user.id);
    if (confirmed) {
      const signedIn = await sessionAfterSignIn(email, password);
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
