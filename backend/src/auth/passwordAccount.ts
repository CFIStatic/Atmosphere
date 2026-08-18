import type { Session, User } from '@supabase/supabase-js';
import { createAdminClient, createAnonClient } from '../lib/supabase.js';
import { HttpError, serviceUnavailable, unauthorized } from '../lib/errors.js';
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

export function isAlreadyRegisteredMessage(message: string): boolean {
  return /already|registered|exists/i.test(message);
}

export function isEmailUnconfirmedError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  return (
    code === 'email_not_confirmed' ||
    message.includes('email not confirmed') ||
    message.includes('email_not_confirmed') ||
    /not confirmed/.test(message)
  );
}

export function isUnconfirmedAuthUser(user: {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}): boolean {
  return !user.email_confirmed_at && !user.confirmed_at;
}

export const EMAIL_TAKEN_MESSAGE =
  'An account with this email already exists. Sign in instead.';

export const INVALID_CREDENTIALS_MESSAGE =
  'Invalid email or password. If you do not have an account yet, use Create an account.';

export function emailTakenError(): HttpError {
  return new HttpError(409, EMAIL_TAKEN_MESSAGE, 'email_taken');
}

/**
 * A leftover confirmed Auth row must not look like "check your email".
 * Matching password → sign in. Wrong password → already exists.
 */
export function signupDecisionForExistingUser(
  user: {
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
  } | null,
  passwordMatched: boolean,
): 'continue' | 'signin' | 'email_taken' {
  if (!user || isUnconfirmedAuthUser(user)) return 'continue';
  return passwordMatched ? 'signin' : 'email_taken';
}

async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ user: User; session: Session } | null> {
  const supabase = createAnonClient();
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    if (signedIn.error) {
      console.warn('[auth] password sign-in failed:', signedIn.error.message);
    }
    return null;
  }
  return { user: signedIn.data.user, session: signedIn.data.session };
}

async function findAuthUserByEmail(email: string): Promise<User | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const needle = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error || !listed.data?.users?.length) return null;
    const match = listed.data.users.find((user) => (user.email ?? '').toLowerCase() === needle);
    if (match) return match;
    if (listed.data.users.length < 200) return null;
  }
  return null;
}

/**
 * Unconfirmed Auth users never completed signup (Supabase "Confirm email" is
 * on, and the confirmation mail often never arrives). The first password
 * submitted on login or signup claims that row so the office console works.
 */
async function claimUnconfirmedAccount(
  email: string,
  password: string,
  status: 200 | 201,
): Promise<PasswordAccountOk | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const user = await findAuthUserByEmail(email);
  if (!user || !isUnconfirmedAuthUser(user)) return null;

  const updated = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (updated.error) {
    console.warn('[auth] confirm user:', updated.error.message);
    return null;
  }

  const signedIn = await signInWithPassword(email, password);
  if (!signedIn) return null;
  return { kind: 'session', status, user: signedIn.user, session: signedIn.session };
}

/**
 * Create a confirmed user via the service role so signup does not depend on
 * Supabase's built-in confirmation SMTP (~2 mails / hour, often unset).
 */
async function signupViaAdmin(email: string, password: string): Promise<PasswordAccountOk | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error) {
    console.warn('[signup] admin.createUser:', created.error.message);
    if (isAlreadyRegisteredMessage(created.error.message)) {
      const existing = await signInWithPassword(email, password);
      if (existing) {
        return { kind: 'session', status: 200, user: existing.user, session: existing.session };
      }
      return claimUnconfirmedAccount(email, password, 200);
    }
    return null;
  }

  const signedIn = await signInWithPassword(email, password);
  if (!signedIn) return null;
  return { kind: 'session', status: 201, user: signedIn.user, session: signedIn.session };
}

/**
 * Password sign-in for the dashboard. Unconfirmed rows are claimed with the
 * password just entered so "Invalid email or password" is not what you get
 * after Create account with Confirm email still on in Supabase.
 */
export async function signInPasswordAccount(
  email: string,
  password: string,
): Promise<PasswordAccountOk | PasswordAccountFail> {
  const existing = await signInWithPassword(email, password);
  if (existing) {
    return { kind: 'session', status: 200, user: existing.user, session: existing.session };
  }

  const claimed = await claimUnconfirmedAccount(email, password, 200);
  if (claimed) return claimed;

  return {
    kind: 'error',
    error: unauthorized(INVALID_CREDENTIALS_MESSAGE, 'invalid_credentials'),
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
  const existing = await findAuthUserByEmail(email);
  if (existing && !isUnconfirmedAuthUser(existing)) {
    const signedIn = await signInWithPassword(email, password);
    if (signedIn) {
      return { kind: 'session', status: 200, user: signedIn.user, session: signedIn.session };
    }
    return { kind: 'error', error: emailTakenError() };
  }

  const viaAdmin = await signupViaAdmin(email, password);
  if (viaAdmin) return viaAdmin;

  if (!createAdminClient()) {
    console.warn(
      '[signup] SUPABASE_SERVICE_ROLE_KEY is unset — public Auth signup will hit email confirmation. Set the service role key so office sign-in works without a confirmation mail.',
    );
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
      return {
        kind: 'error',
        error: new HttpError(
          429,
          'Too many sign-up attempts right now. Wait a few minutes and try again.',
          'rate_limited',
        ),
      };
    }

    const claimed = await claimUnconfirmedAccount(email, password, 200);
    if (claimed) return claimed;

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

  if (data.user?.id) {
    const claimed = await claimUnconfirmedAccount(email, password, 201);
    if (claimed) return claimed;

    const listed = await findAuthUserByEmail(email);
    if (signupDecisionForExistingUser(listed, false) === 'email_taken') {
      return { kind: 'error', error: emailTakenError() };
    }
  }

  return {
    kind: 'confirm',
    user: data.user ?? null,
    message: 'Account created. Check your email to confirm before signing in.',
  };
}
