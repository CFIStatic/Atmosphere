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
  RESEND_VERIFIED_FROM,
  fetchResendDomains,
  isResendOnboardingFrom,
  isResendSenderRestriction,
  resendFromAddress,
  resendFromCandidates,
} from './resendFrom.js';

/**
 * Platform mail — Atmosphere sends it (invites, OTPs, resets, contact/careers).
 *
 *   1. Resend as hello@invites.atmosphereteam.com (Reply-To hello@atmosphereteam.com).
 *   2. SMTP only when Resend is unset / SYSTEM_MAIL_DRIVER=smtp and the
 *      SMTP account can authenticate the From domain.
 *   3. File log sink in development when neither is configured.
 */

function fromAddress(): string {
  return resendFromAddress();
}

function driverOverride(): string {
  return (process.env.SYSTEM_MAIL_DRIVER ?? '').trim().toLowerCase();
}

function defaultReplyTo(): string | null {
  // CAREERS_FROM is the Reply-To for transactional mail. Must be same org as
  // From (atmosphereteam.com) or alignedReplyTo strips it.
  const reply = (config.careers.fromEmail || 'hello@atmosphereteam.com').trim();
  return reply || null;
}

/** Dev file sink when SMTP/Resend are unset (or SYSTEM_MAIL_DRIVER=log). */
export function logMailEnabled(): boolean {
  const driver = driverOverride();
  if (driver === 'log') return true;
  if (driver === 'smtp' || driver === 'resend' || driver === 'off') return false;
  return !config.isProduction && !smtpConfigured() && !process.env.RESEND_API_KEY?.trim();
}

function mailFrom(): string {
  return fromAddress() || RESEND_VERIFIED_FROM;
}

function smtpUsableForFrom(from: string): boolean {
  if (!smtpConfigured()) return false;
  if (driverOverride() === 'smtp') return true;
  return smtpFromMatchesAccount(from, process.env.SMTP_USER);
}

export function systemMailConfigured(): boolean {
  if (logMailEnabled()) return true;
  if (process.env.RESEND_API_KEY?.trim()) return true;
  return smtpUsableForFrom(mailFrom());
}

/** Readiness detail for /api/ready — transport + preferred From (never keys). */
export async function mailReadyCheck(): Promise<{
  ok: boolean;
  detail: string;
}> {
  if (!systemMailConfigured()) {
    return { ok: false, detail: 'unconfigured' };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey) {
    const from = resendFromAddress();
    const listed = await fetchResendDomains(apiKey);
    if (listed.ok) {
      const domains =
        listed.domains.length > 0
          ? listed.domains.map((d) => `${d.name}:${d.status}`).join(',')
          : 'none';
      return { ok: true, detail: `resend from=${from} domains=${domains}` };
    }
    if (listed.restricted) {
      return { ok: true, detail: `resend from=${from} (send-only key)` };
    }
    return { ok: true, detail: `resend from=${from} (domains list unavailable)` };
  }
  if (smtpUsableForFrom(mailFrom())) {
    return { ok: true, detail: `smtp from=${mailFrom()}` };
  }
  if (logMailEnabled()) {
    return { ok: true, detail: 'log' };
  }
  return { ok: false, detail: 'unconfigured' };
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
  // No domains-list round-trip on send — From is always the verified subdomain.
  const froms = resendFromCandidates({
    configuredFrom: input.from,
    allowOnboardingFallback: !config.isProduction,
  });

  let last: { ok: false; why: string; status?: number; body?: string } | null = null;
  for (const from of froms) {
    if (from !== input.from) {
      console.info(`[system-mail] Resend from ${input.from} → ${from}`);
    }
    const replyTo = input.keepReplyTo
      ? input.replyTo?.trim() || null
      : alignedReplyTo(from, input.replyTo);
    const result = await postResend({ ...input, apiKey, from, replyTo });
    if (result.ok) {
      if (isResendOnboardingFrom(from)) {
        console.warn(
          '[system-mail] delivered via onboarding@resend.dev — only the Resend account owner receives this. Set RESEND_FROM_EMAIL=hello@invites.atmosphereteam.com and verify invites.atmosphereteam.com.',
        );
      }
      return result;
    }
    last = result;
    if (!result.status || !isResendSenderRestriction(result.status, result.body ?? '')) {
      break;
    }
    console.warn(`[system-mail] ${from} was rejected; trying the next sender`);
  }

  if (last?.body && isResendSenderRestriction(last.status ?? 0, last.body)) {
    console.error(
      `[system-mail] Resend rejected ${froms.join(' → ')}. Verify invites.atmosphereteam.com and set RESEND_FROM_EMAIL=hello@invites.atmosphereteam.com.`,
    );
  }
  return {
    ok: false,
    why:
      last?.why ??
      'The email could not be sent. Verify invites.atmosphereteam.com on Resend and set RESEND_FROM_EMAIL=hello@invites.atmosphereteam.com.',
  };
}

export async function sendSystemMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  /** Contact/careers keep the visitor inbox as Reply-To. */
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
    smtpReady: smtpUsableForFrom(from),
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
      if (!smtpUsableForFrom(from)) {
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
