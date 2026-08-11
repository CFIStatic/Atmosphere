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
 * Delivery order:
 *   1. SMTP (SMTP_HOST + SMTP_USER + SMTP_PASS + CAREERS_FROM_EMAIL)
 *   2. Resend API (RESEND_API_KEY + CAREERS_FROM_EMAIL / EMAIL_MARKETING_FROM)
 */

function fromAddress(): string {
  return (
    config.careers.fromEmail ||
    process.env.EMAIL_MARKETING_FROM ||
    process.env.SMTP_USER ||
    ''
  ).trim();
}

export function systemMailConfigured(): boolean {
  const from = fromAddress();
  if (!from) return false;
  if (smtpConfigured()) return true;
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  from: string;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Atmosphere <${input.from}>`,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.error('[system-mail] Resend failed:', errText.slice(0, 500));
      return { ok: false, why: 'The email could not be sent.' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[system-mail] Resend send failed:', (err as Error)?.message ?? err);
    return { ok: false, why: 'The email could not be sent.' };
  }
}

export async function sendSystemMail(input: {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternate — clients that support it show this. */
  html?: string | null;
  /** Optional reply-to (e.g. the inviting office contact). */
  replyTo?: string | null;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  const from = fromAddress();
  if (!from) {
    return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
  }

  if (smtpConfigured()) {
    try {
      await getTransporter().sendMail({
        from: `"Atmosphere" <${from}>`,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      });
      return { ok: true };
    } catch (err) {
      console.error('[system-mail] SMTP send failed:', (err as Error)?.message ?? err);
      // Fall through to Resend when SMTP is misconfigured but Resend is available.
      if (!process.env.RESEND_API_KEY?.trim()) {
        return { ok: false, why: 'The email could not be sent.' };
      }
    }
  }

  if (process.env.RESEND_API_KEY?.trim()) {
    return sendViaResend({ ...input, from });
  }

  return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
}
