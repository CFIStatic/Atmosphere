import type { Session, User } from '@supabase/supabase-js';
import { createAnonClient } from '../lib/supabase.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { sendSystemMail } from '../lib/systemMail.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { progressSignInEmail } from './progressSignInEmail.js';
import { createOtpThrottle } from './phoneAuth.js';

/**
 * "Email me a code": a 6-digit one-time code as an alternative to the password.
 *
 * Existing accounts only. Admin generateLink({ type: 'magiclink' }) fails for
 * an unknown address and never creates a user (the same as signInWithOtp with
 * shouldCreateUser: false), and it returns the email OTP without Supabase
 * sending its own mail. We mail just the code through platform mail
 * (Resend), so it works inside the mobile app: no link to open.
 *
 * The response is the same whether or not the account exists, so this
 * cannot be used to probe for accounts.
 */

export function normalizeCodeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const throttle = createOtpThrottle();

export async function sendEmailSignInCode(email: string): Promise<void> {
  const address = normalizeCodeEmail(email);
  const verdict = throttle.check(address);
  if (!verdict.ok) {
    throw new HttpError(
      429,
      `A code was just sent. You can request another in ${verdict.retryAfterSeconds} seconds.`,
      'otp_throttled',
    );
  }
  const admin = unscopedAdminOrNull();
  if (!admin) throw new HttpError(503, 'Email codes are not available right now.', 'signin_unavailable');
  throttle.record(address);

  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: address });
  const code = generated.data?.properties?.email_otp;
  if (generated.error || !code) {
    // No account (or Auth hiccup): same answer as success, no mail.
    if (generated.error) console.info('[email-code] no code issued:', generated.error.message);
    return;
  }
  const mail = progressSignInEmail({ url: publicAppOrigin(), code });
  const result = await sendSystemMail({ to: address, subject: mail.subject, text: mail.text, html: mail.html });
  if (!result.ok) {
    console.warn('[email-code] mail failed');
    throw new HttpError(502, 'Could not send the code. Try again in a minute.', 'otp_send_failed');
  }
}

export async function verifyEmailSignInCode(email: string, code: string): Promise<{ session: Session; user: User }> {
  const address = normalizeCodeEmail(email);
  const { data, error } = await createAnonClient().auth.verifyOtp({ type: 'email', email: address, token: code });
  if (error || !data.session || !data.user) {
    throw new HttpError(401, 'That code is incorrect or expired. Request a new one.', 'otp_invalid');
  }
  return { session: data.session, user: data.user };
}
