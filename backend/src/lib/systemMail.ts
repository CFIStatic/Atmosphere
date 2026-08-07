import { config } from '../config.js';
import { getTransporter, smtpConfigured } from './careersMail.js';

/**
 * Platform mail — Atmosphere sends it.
 *
 * Job invites, claim codes, and other "come into the system" messages go out
 * from our SMTP account, not from a customer's connected Gmail/Microsoft
 * mailbox. Campaigns still send as the customer when they connect one; invites
 * do not wait on that.
 *
 * Same transport as careers/contact: one SMTP env serves transactional mail.
 */

export function systemMailConfigured(): boolean {
  return smtpConfigured() && Boolean(config.careers.fromEmail);
}

export async function sendSystemMail(input: {
  to: string;
  subject: string;
  text: string;
  /** Optional reply-to (e.g. the inviting office contact). */
  replyTo?: string | null;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!systemMailConfigured()) {
    return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
  }
  try {
    await getTransporter().sendMail({
      from: `"Atmosphere" <${config.careers.fromEmail}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return { ok: true };
  } catch {
    return { ok: false, why: 'The email could not be sent.' };
  }
}
