/**
 * Outbound email for storm outreach and check-ins.
 *
 * Providers:
 *   log    — default. Records the send without leaving the server.
 *   resend — https://resend.com when RESEND_API_KEY is configured.
 */

import { config } from '../config.js';

export interface SendEmailInput {
  to: string;
  toName?: string | null;
  subject: string;
  bodyText: string;
  fromName: string;
  replyTo?: string | null;
}

export interface SendEmailResult {
  provider: string;
  messageId: string;
  delivered: boolean;
}

export type EmailMarketingProvider = 'log' | 'resend';

function resolveProvider(): EmailMarketingProvider {
  const configured = config.emailMarketing.provider;
  if (configured === 'resend' && config.emailMarketing.resendApiKey) return 'resend';
  return 'log';
}

async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const fromDomain = config.emailMarketing.fromDomain || 'onboarding@resend.dev';
  const from = `${input.fromName} <${fromDomain.includes('@') ? fromDomain : `outreach@${fromDomain}`}>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.emailMarketing.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.toName ? `${input.toName} <${input.to}>` : input.to],
      subject: input.subject,
      text: input.bodyText,
      reply_to: input.replyTo || undefined,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    throw new Error(body.message || `Resend send failed (${res.status})`);
  }

  return {
    provider: 'resend',
    messageId: body.id || `resend-${Date.now()}`,
    delivered: true,
  };
}

async function sendViaLog(input: SendEmailInput): Promise<SendEmailResult> {
  // Development / default path: the message is persisted on em_outreach_messages
  // by the caller; we only need a stable id and a clear provider label.
  console.info(
    `[email-marketing:log] to=${input.to} subject=${JSON.stringify(input.subject)}`,
  );
  return {
    provider: 'log',
    messageId: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    delivered: true,
  };
}

export async function sendMarketingEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = resolveProvider();
  if (provider === 'resend') return sendViaResend(input);
  return sendViaLog(input);
}

export function currentEmailProvider(): EmailMarketingProvider {
  return resolveProvider();
}
