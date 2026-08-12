import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
 *   3. File log sink in development (or SYSTEM_MAIL_DRIVER=log) so Approve &
 *      invite still delivers a readable invite when SMTP/Resend are unset
 */

function fromAddress(): string {
  return (
    config.careers.fromEmail ||
    process.env.EMAIL_MARKETING_FROM ||
    process.env.SMTP_USER ||
    ''
  ).trim();
}

function driverOverride(): string {
  return (process.env.SYSTEM_MAIL_DRIVER ?? '').trim().toLowerCase();
}

/**
 * When neither SMTP nor Resend is wired, development still needs a working
 * invite path. The log sink writes .eml-ish files under backend/.mail/ so
 * operators can open the invite, and returns ok so the product flow continues.
 */
export function logMailEnabled(): boolean {
  const driver = driverOverride();
  if (driver === 'log') return true;
  if (driver === 'smtp' || driver === 'resend' || driver === 'off') return false;
  return !config.isProduction && !smtpConfigured() && !process.env.RESEND_API_KEY?.trim();
}

export function systemMailConfigured(): boolean {
  if (logMailEnabled()) return true;
  const from = fromAddress();
  if (!from) return false;
  if (smtpConfigured()) return true;
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function mailFrom(): string {
  return fromAddress() || 'noreply@atmosphere.local';
}

async function sendViaLog(input: {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  from: string;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const dir = path.resolve(process.cwd(), '.mail');
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = input.to.replace(/[^a-zA-Z0-9._@+-]/g, '_').slice(0, 80);
    const base = path.join(dir, `${stamp}_${safeTo}`);
    const header = [
      `From: Atmosphere <${input.from}>`,
      `To: ${input.to}`,
      input.replyTo ? `Reply-To: ${input.replyTo}` : null,
      `Subject: ${input.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      '',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    await writeFile(`${base}.txt`, `${header}${input.text}\n`, 'utf8');
    if (input.html) {
      await writeFile(`${base}.html`, input.html, 'utf8');
    }
    console.info(`[system-mail] logged invite for ${input.to} → ${base}.txt`);
    return { ok: true };
  } catch (err) {
    console.error('[system-mail] log sink failed:', (err as Error)?.message ?? err);
    return { ok: false, why: 'The email could not be saved.' };
  }
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
  const from = mailFrom();
  const driver = driverOverride();

  if (driver === 'log' || (logMailEnabled() && driver !== 'smtp' && driver !== 'resend')) {
    // Prefer real transports when present, even if log is the auto fallback.
    if (!smtpConfigured() && !process.env.RESEND_API_KEY?.trim()) {
      return sendViaLog({ ...input, from });
    }
  }

  if (!fromAddress() && !logMailEnabled()) {
    return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
  }

  if (smtpConfigured() && driver !== 'resend' && driver !== 'log') {
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
        if (logMailEnabled()) return sendViaLog({ ...input, from });
        return { ok: false, why: 'The email could not be sent.' };
      }
    }
  }

  if (process.env.RESEND_API_KEY?.trim() && driver !== 'log') {
    const result = await sendViaResend({ ...input, from });
    if (result.ok) return result;
    if (logMailEnabled()) return sendViaLog({ ...input, from });
    return result;
  }

  if (logMailEnabled()) {
    return sendViaLog({ ...input, from });
  }

  return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
}
