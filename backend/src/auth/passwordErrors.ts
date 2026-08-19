/**
 * Classify Supabase Auth failures without talking to the network.
 *
 * Login and signup both collapse several distinct outcomes into one error
 * object. The login page used to report every rejection as "invalid email or
 * password", which is exactly the trap an unconfirmed account creates: the
 * address is already registered, the password is right, and sign-in still
 * fails.
 */

export interface AuthLikeError {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

export function isEmailNotConfirmed(error: AuthLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'email_not_confirmed') return true;
  return /email not confirmed/i.test(error.message ?? '');
}

export function isUserAlreadyRegistered(error: AuthLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists|user already/i.test(error.message ?? '');
}

/**
 * Supabase's anti-enumeration signup response: HTTP 200, a user-shaped object
 * with an empty `identities` array, and no session. That is not a new account
 * waiting on a confirmation email — it is "this address is taken".
 */
export function isObfuscatedExistingUser(
  user: { identities?: unknown[] | null } | null | undefined,
  session: unknown,
): boolean {
  if (session) return false;
  if (!user) return false;
  return Array.isArray(user.identities) && user.identities.length === 0;
}

export type PasswordSignInKind =
  | 'session'
  | 'transient'
  | 'email_not_confirmed'
  | 'invalid';

export function classifyPasswordSignIn(input: {
  error: AuthLikeError | null | undefined;
  hasSession: boolean;
  hasUser: boolean;
  transient: boolean;
}): PasswordSignInKind {
  if (input.hasSession && input.hasUser && !input.error) return 'session';
  if (input.transient) return 'transient';
  if (isEmailNotConfirmed(input.error)) return 'email_not_confirmed';
  return 'invalid';
}

export const EXISTING_ACCOUNT_MESSAGE =
  'An account already exists for this email. Sign in, or reset your password if you do not remember it.';

export const EMAIL_UNCONFIRMED_MESSAGE =
  'This email is not confirmed yet. Check your inbox for a confirmation link, or reset your password to finish signing in.';
