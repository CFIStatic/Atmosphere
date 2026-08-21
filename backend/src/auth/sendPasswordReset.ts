import { createAdminClient, createAnonClient } from '../lib/supabase.js';
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
 * Email a recovery link that opens the live office app.
 *
 * Prefer minting a token_hash and sending it ourselves: that URL never goes
 * through GoTrue's redirect, so a leftover Site URL of localhost:3000 cannot
 * hijack the click. Fall back to Supabase's mailer with the same public
 * redirect when the admin client or Atmosphere mail is unavailable.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const redirectTo = passwordResetRedirectUrl();
  const sentDirectly = await sendDirectRecoveryEmail(email, redirectTo);
  if (sentDirectly) return;

  const supabase = createAnonClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.warn('[forgot-password] supabase error:', error.status, error.message);
  }
}

async function sendDirectRecoveryEmail(email: string, redirectTo: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;

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
    return false;
  }

  const mail = passwordResetEmail({ url: recoveryPageUrl(redirectTo, tokenHash) });
  const result = await sendSystemMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if (!result.ok) {
    console.warn('[forgot-password] system-mail failed, falling back to supabase mailer:', result.why);
    return false;
  }
  return true;
}
