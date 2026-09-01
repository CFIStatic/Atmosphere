import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getTransporter, smtpConfigured } from './smtpTransport.js';
import {
  alignedReplyTo,
  deliverabilityHeaders,
  formatFromHeader,
  resendTags,
  smtpFromMatchesAccount,
  systemMailTransportOrder,
} from './mailDeliverability.js';
import {
  RESEND_ONBOARDING_FROM,
  RESEND_VERIFIED_FROM,
  fetchResendDomains,
  isResendSenderRestriction,
  pickResendFromAddressForList,
  uniqueResendFroms,
} from './resendFrom.js';

/**
 * Platform mail — Atmosphere sends it.
 *
 * Job invites, claim codes, and other "come into the system" messages go out
 * from our authenticated sending domain, not from a customer's connected
 * Gmail/Microsoft mailbox. Campaigns still send as the customer when they
 * connect one; invites do not wait on that.
 *
 * Delivery order (inbox placement, not historical habit):
 *   1. Resend API (RESEND_API_KEY). From is hello@invites.jettx.ai — the
 *      domain with DKIM + SES return-path. Reply-To stays jack@jettx.ai
 *      when that address is the same org. Falls back to
 *      onboarding@resend.dev only if Resend still rejects the From.
 *   2. SMTP only when Resend is unset, or SYSTEM_MAIL_DRIVER=smtp, and only
 *      when the SMTP account can authenticate the From domain. Sending
 *      jack@jettx.ai through a Yahoo/Gmail SMTP login is what put Atmosphere
 *      mail in junk.
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
  headers?: Record<string, string>;
}): Promise<{ ok: true } | { ok: false; why: string; status?: number; body?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formatFromHeader(input.from),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        tags: resendTags('transactional'),
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
  headers?: Record<string, string>;
  keepReplyTo?: boolean;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
  }
  const listed = await fetchResendDomains(apiKey);
  const picked = pickResendFromAddressForList(input.from, listed);
  const froms = uniqueResendFroms(picked, RESEND_VERIFIED_FROM, RESEND_ONBOARDING_FROM);

  let last: { ok: false; why: string; status?: number; body?: string } | null = null;
  for (const from of froms) {
    if (from !== input.from) {
      console.info(`[system-mail] Resend from ${input.from} → ${from}`);
    }
    const replyTo = input.keepReplyTo
      ? input.replyTo?.trim() || null
      : alignedReplyTo(from, input.replyTo);
    const result = await postResend({ ...input, apiKey, from, replyTo });
    if (result.ok) return result;
    last = result;
    if (!result.status || !isResendSenderRestriction(result.status, result.body ?? '')) {
      break;
    }
    console.warn(`[system-mail] ${from} was rejected; trying the next sender`);
  }

  if (last?.body && isResendSenderRestriction(last.status ?? 0, last.body)) {
    console.error(
      `[system-mail] Resend rejected ${froms.join(' → ')}. invites.jettx.ai is the verified sending domain.`,
    );
  }
  return { ok: false, why: last?.why ?? 'The email could not be sent.' };
}

export async function sendSystemMail(input: {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternate — clients that support it show this. */
  html?: string | null;
  /** Optional reply-to (e.g. the inviting office contact). */
  replyTo?: string | null;
  /**
   * Contact / careers forms must keep the visitor's inbox as Reply-To so
   * a reply reaches them. Invite / OTP mail aligns Reply-To to the From
   * org so a yahoo.com Reply-To on a jettx.ai From does not look spoofed.
   */
  keepReplyTo?: boolean;
}): Promise<{ ok: true } | { ok: false; why: string }> {
  const from = mailFrom();
  const driver = driverOverride();
  const requestedReplyTo = input.replyTo?.trim() || defaultReplyTo();
  const replyTo = input.keepReplyTo
    ? requestedReplyTo
    : alignedReplyTo(from, requestedReplyTo);
  const sendId = randomUUID();
  const headers = deliverabilityHeaders({ kind: 'transactional', sendId });
  const payload = { ...input, replyTo, from, headers };

  const order = systemMailTransportOrder({
    driver,
    resendReady: Boolean(process.env.RESEND_API_KEY?.trim()),
    smtpReady: smtpConfigured(),
    logReady: logMailEnabled(),
  });

  if (order.length === 0) {
    return { ok: false, why: 'Atmosphere mail is not configured on this server.' };
  }

  let lastWhy = 'The email could not be sent.';
  for (const transport of order) {
    if (transport === 'resend') {
      const result = await sendViaResend(payload);
      if (result.ok) return result;
      lastWhy = result.why;
      continue;
    }

    if (transport === 'smtp') {
      if (
        !smtpFromMatchesAccount(from, process.env.SMTP_USER) &&
        driver !== 'smtp'
      ) {
        console.warn(
          `[system-mail] skipping SMTP — ${process.env.SMTP_USER || '(no user)'} cannot authenticate From ${from}`,
        );
        continue;
      }
      try {
        await getTransporter().sendMail({
          from: formatFromHeader(from),
          to: input.to,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
          ...(replyTo ? { replyTo } : {}),
          headers,
        });
        return { ok: true };
      } catch (err) {
        console.error('[system-mail] SMTP send failed:', (err as Error)?.message ?? err);
        lastWhy = 'The email could not be sent.';
        continue;
      }
    }

    if (transport === 'log') {
      return sendViaLog(payload);
    }
  }

  return { ok: false, why: lastWhy };
}
