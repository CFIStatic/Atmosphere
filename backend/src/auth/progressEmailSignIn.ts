import type { Session, User } from '@supabase/supabase-js';
import { createAnonClient } from '../lib/supabase.js';
import { requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { sendSystemMail } from '../lib/systemMail.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { shareState } from '../verifier/library.js';
import { isAlreadyRegisteredMessage } from './passwordAccount.js';
import { progressSignInEmail } from './progressSignInEmail.js';

/**
 * Email-only (passwordless) sign-in for the person a job file was shared with.
 *
 * The visitor never types an address: the link always goes to the share's own
 * recipient_email, so this endpoint cannot be used to probe whether an
 * account exists or to mail anyone else. Verifying the link or code only
 * succeeds when the resulting Auth user's email is that same recipient. The
 * claim afterwards still goes through claimProgressShareForUser, unchanged.
 *
 * Office / org login is untouched; it keeps email + password.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ProgressSignInKind = 'magiclink' | 'invite';

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Link the email button opens: the job file itself, carrying a one-time token hash. */
export function progressSignInUrl(
  origin: string,
  shareToken: string,
  tokenHash: string,
  kind: ProgressSignInKind,
): string {
  const url = new URL(`/progress/${encodeURIComponent(shareToken)}`, origin);
  url.searchParams.set('signin', tokenHash);
  url.searchParams.set('kind', kind);
  return url.toString();
}

/** Only the invited address may come out of verification signed in. */
export function assertInvitedUser(user: Pick<User, 'email'> | null | undefined, recipient: string): void {
  const email = normalizeEmail(user?.email);
  if (!recipient || !email || email !== recipient) {
    throw new HttpError(
      403,
      'This sign-in link is for a different email. Ask for a new link from the job page.',
      'email_mismatch',
    );
  }
}

async function liveShareRecipient(token: string): Promise<{ recipient: string; orgName: string | null; token: string }> {
  const admin = unscopedAdminOrNull() ?? requireAdmin();
  const { data: share, error } = await admin
    .from('verifier_shares')
    .select('id, org_id, job_id, recipient_email, expires_at, revoked_at, share_kind, access_token')
    .eq('access_token', token)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'share_lookup_failed');
  const state = shareState(share as any);
  if (state === 'missing' || (share as any)?.share_kind !== 'progress') {
    throw new HttpError(404, 'This link does not exist.', 'not_found');
  }
  if (state === 'revoked') throw new HttpError(410, 'This link was revoked.', 'revoked');
  if (state === 'expired') throw new HttpError(410, 'This link has expired.', 'expired');
  const recipient = normalizeEmail((share as any).recipient_email);
  if (!recipient) {
    throw new HttpError(
      400,
      'This job file was not shared with an email address, so it cannot be saved to an account.',
      'no_recipient',
    );
  }
  const { data: org } = await admin
    .from('orgs')
    .select('name')
    .eq('id', (share as any).org_id)
    .maybeSingle();
  return {
    recipient,
    orgName: ((org as any)?.name as string | undefined) ?? null,
    token: (share as any).access_token as string,
  };
}

/**
 * Email the invited address a sign-in link + code. Existing accounts (password
 * or not) get a magic link; first-time viewers get an invite link that creates
 * the account on click. Same response either way.
 */
export async function sendProgressSignInLink(shareToken: string): Promise<{ sentTo: string }> {
  const { recipient, orgName, token } = await liveShareRecipient(shareToken);
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw new HttpError(503, 'Email sign-in is not available right now.', 'signin_unavailable');
  }
  const origin = publicAppOrigin();
  const redirectTo = `${origin}/progress/${encodeURIComponent(token)}`;

  let kind: ProgressSignInKind = 'magiclink';
  let generated = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: recipient,
    options: { redirectTo },
  });
  if (generated.error && !isAlreadyRegisteredMessage(generated.error.message ?? '')) {
    // No account yet: an invite link creates it when they click.
    kind = 'invite';
    generated = await admin.auth.admin.generateLink({
      type: 'invite',
      email: recipient,
      options: { redirectTo },
    });
  }
  // Email-only sign-in is for homeowners. Anyone who already belongs to an
  // org (contractors, subs) keeps their real password account.
  const existingUserId = kind === 'magiclink' ? generated.data?.user?.id : null;
  if (existingUserId && (await isOrgMember(admin, existingUserId))) {
    throw new HttpError(
      409,
      'This email has an Atmosphere work account. Sign in with your password to open this job.',
      'password_required',
    );
  }
  const props = generated.data?.properties;
  if (generated.error || !props?.hashed_token) {
    console.warn('[progress-signin] generateLink:', generated.error?.message);
    throw new HttpError(502, 'Could not send the sign-in email. Try again in a minute.', 'signin_send_failed');
  }

  const mail = progressSignInEmail({
    url: progressSignInUrl(origin, token, props.hashed_token, kind),
    code: props.email_otp ?? null,
    orgName,
  });
  const result = await sendSystemMail({ to: recipient, subject: mail.subject, text: mail.text, html: mail.html });
  if (!result.ok) {
    console.warn('[progress-signin] mail failed:', (result as any).why);
    throw new HttpError(502, 'Could not send the sign-in email. Try again in a minute.', 'signin_send_failed');
  }
  return { sentTo: recipient };
}

async function isOrgMember(admin: NonNullable<ReturnType<typeof unscopedAdminOrNull>>, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('org_members').select('org_id').eq('user_id', userId).limit(1);
  if (error) return true; // fail closed: never mint a passwordless link we cannot vet
  return (data ?? []).length > 0;
}

/** Turn the email link (token hash) or the 6-digit code into a session for the invitee. */
export async function verifyProgressSignIn(input: {
  shareToken: string;
  tokenHash?: string | null;
  kind?: ProgressSignInKind | null;
  code?: string | null;
}): Promise<{ session: Session; user: User }> {
  const { recipient } = await liveShareRecipient(input.shareToken);
  const supabase = createAnonClient();
  const invalid = () =>
    new HttpError(401, 'That sign-in link or code is invalid or has expired. Send a new one.', 'invalid_signin');

  let session: Session | null = null;
  let user: User | null = null;
  if (input.tokenHash) {
    const type = input.kind === 'invite' ? 'invite' : 'magiclink';
    const r = await supabase.auth.verifyOtp({ type, token_hash: input.tokenHash });
    session = r.data.session;
    user = r.data.user;
  } else if (input.code) {
    for (const type of ['email', 'invite'] as const) {
      const r = await supabase.auth.verifyOtp({ type, email: recipient, token: input.code });
      if (!r.error && r.data.session) {
        session = r.data.session;
        user = r.data.user;
        break;
      }
    }
  }
  if (!session || !user) throw invalid();
  assertInvitedUser(user, recipient);
  const admin = unscopedAdminOrNull();
  if (admin && (await isOrgMember(admin, user.id))) {
    throw new HttpError(
      409,
      'This email has an Atmosphere work account. Sign in with your password to open this job.',
      'password_required',
    );
  }
  return { session, user };
}
