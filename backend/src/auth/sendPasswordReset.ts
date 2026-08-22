import { createAdminClient } from '../lib/supabase.js';
import { sendSystemMail } from '../lib/systemMail.js';
import {
  passwordResetRedirectUrl,
  recoveryPageUrl,
} from '../lib/publicAppOrigin.js';
import { passwordResetEmail } from './passwordResetEmail.js';

function isUnknownUserMessage(message: string | undefined): boolean {
  if (!message) return false;
  return /not found|unable to (find|locate)|user not found/i.test(message);
}

/**
 * Email a recovery link from Atmosphere — never Supabase Auth.
 *
 * Mint a token_hash and send it with our SMTP/Resend so the From line, the
 * template, and the click target are all Atmosphere. There is no fallback to
 * resetPasswordForEmail: that is the "Supabase Auth / Reset your password"
 * mail that was landing in the inbox (and redirecting to localhost:3000).
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    console.warn(
      '[forgot-password] SUPABASE_SERVICE_ROLE_KEY is unset — Atmosphere cannot mint a reset link. No email sent.',
    );
    return;
  }

  const redirectTo = passwordResetRedirectUrl();
  const generated = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  const tokenHash = generated.data?.properties?.hashed_token;
  if (generated.error || !tokenHash) {
    if (generated.error && !isUnknownUserMessage(generated.error.message)) {
      console.warn('[forgot-password] generateLink:', generated.error.message);
    }
    return;
  }

  const mail = passwordResetEmail({ url: recoveryPageUrl(redirectTo, tokenHash) });
  const result = await sendSystemMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if (!result.ok) {
    console.warn('[forgot-password] Atmosphere mail failed:', result.why);
  }
}
