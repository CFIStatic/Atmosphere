import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getTransporter, smtpConfigured } from './careersMail.js';
import {
  RESEND_ONBOARDING_FROM,
  fetchResendDomains,
  isResendSenderRestriction,
  pickResendFromAddress,
} from './resendFrom.js';

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
 *   2. Resend API (RESEND_API_KEY). From-address is a verified Resend domain
 *      when one exists; otherwise Atmosphere <onboarding@resend.dev>.
 *   3. File log sink in development (or SYSTEM_MAIL_DRIVER=log) so Approve &
 *      invite still delivers a readable invite when SMTP/Resend are unset
 */

function fromAddress(): string {
  return (
    process.env.CAREERS_FROM_EMAIL ||
    process.env.EMAIL_MARKETING_FROM ||
    process.env.SMTP_USER ||
    config.careers.fromEmail ||
    'jack@jettx.ai'
  ).trim();
}

function driverOverride(): string {
  return (process.env.SYSTEM_MAIL_DRIVER ?? '').trim().toLowerCase();
}

function defaultReplyTo(): string | null {
  const reply = (config.careers.toEmail || 'jack@jettx.ai').trim();
  return reply || null;
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
  if (smtpConfigured()) return true;
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function mailFrom(): string {
  return fromAddress() || 'jack@jettx.ai';
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
      .filter((line): line is string => Boolean(line))
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

async function postResend(input: {
  apiKey: string;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  from: string;
}): Promise<{ ok: true } | { ok: false; why: string; status?: number; body?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
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
      return {
        ok: false,
        why: 'The email could not be sent.',
        status: res.status,
        body: errText,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error('[system-mail] Resend send failed:', (err as Error)?.message ?? err);
    return { ok: false, why: 'The email could not be sent.' };
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
  const domains = await fetchResendDomains(apiKey);
  const from = pickResendFromAddress(input.from, domains);
  if (from !== input.from) {
    console.info(`[system-mail] Resend from ${input.from} → ${from}`);
  }

  const first = await postResend({ ...input, apiKey, from });
  if (first.ok) return first;

  if (
    from !== RESEND_ONBOARDING_FROM &&
    first.status != null &&
    isResendSenderRestriction(first.status, first.body ?? '')
  ) {
    console.warn(
      `[system-mail] ${from} was rejected; retrying as ${RESEND_ONBOARDING_FROM}`,
    );
    const retry = await postResend({ ...input, apiKey, from: RESEND_ONBOARDING_FROM });
    if (retry.ok) return retry;
    if (retry.body && isResendSenderRestriction(retry.status ?? 0, retry.body)) {
      console.error(
        '[system-mail] Resend is still in test mode. Verify jettx.ai at resend.com/domains (DNS records are printed on each deploy) so invites can leave the account owner inbox.',
      );
    }
    return { ok: false, why: retry.why };
  }

  if (first.body && isResendSenderRestriction(first.status ?? 0, first.body)) {
    console.error(
      '[system-mail] Resend is still in test mode. Verify jettx.ai at resend.com/domains (DNS records are printed on each deploy) so invites can leave the account owner inbox.',
    );
  }
  return { ok: false, why: first.why };
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
  const replyTo = input.replyTo?.trim() || defaultReplyTo();
  const payload = { ...input, replyTo, from };

  if (driver === 'log' || (logMailEnabled() && driver !== 'smtp' && driver !== 'resend')) {
    // Prefer real transports when present, even if log is the auto fallback.
    if (!smtpConfigured() && !process.env.RESEND_API_KEY?.trim()) {
      return sendViaLog(payload);
    }
  }

  if (!smtpConfigured() && !process.env.RESEND_API_KEY?.trim()) {
    if (logMailEnabled()) return sendViaLog(payload);
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
        ...(replyTo ? { replyTo } : {}),
      });
      return { ok: true };
    } catch (err) {
      console.error('[system-mail] SMTP send failed:', (err as Error)?.message ?? err);
      // Fall through to Resend when SMTP is misconfigured but Resend is available.
      if (!process.env.RESEND_API_KEY?.trim()) {
        if (logMailEnabled()) return sendViaLog(payload);
        return { ok: false, why: 'The email could not be sent.' };
      }
    }
  }

  if (process.env.RESEND_API_KEY?.trim() && driver !== 'log') {
    const result = await sendViaResend(payload);
    if (result.ok) return result;
    if (logMailEnabled()) return sendViaLog(payload);
    return result;
  }

  if (logMailEnabled()) {
    return sendViaLog(payload);
  }

  return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
}
