/**
 * Headers and sender rules that keep Atmosphere mail out of junk.
 *
 * Inbox placement is mostly DNS (SPF / DKIM / DMARC on jettx.ai). This
 * module is the part the app controls: a unique entity id so Gmail does
 * not thread every invite together, Auto-Submitted so filters treat OTPs
 * as transactional, and a From / Reply-To pair that stays inside the same
 * organizational domain.
 */

import { randomUUID } from 'node:crypto';
import { emailDomain } from './resendFrom.js';

export const PLATFORM_FROM_NAME = 'Atmosphere';
export const SENDER_IDENTITY_LINE = 'Sent by Atmosphere · jettx.ai';

export type MailKind = 'transactional' | 'marketing';

const MULTI_PART_PUBLIC_SUFFIXES = new Set(['co.uk', 'com.au', 'co.nz', 'com.br', 'co.jp']);

/**
 * Cheap eTLD+1. `.ai` is a normal TLD (jettx.ai), not a two-label suffix.
 * invites.jettx.ai and jack@jettx.ai are the same organization.
 */
export function organizationalDomain(host: string): string {
  const parts = host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .split('.')
    .filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function sameOrganization(a: string, b: string): boolean {
  const left = organizationalDomain(emailDomain(a) || a);
  const right = organizationalDomain(emailDomain(b) || b);
  return Boolean(left && right && left === right);
}

export function formatFromHeader(
  address: string,
  displayName = PLATFORM_FROM_NAME,
): string {
  const cleanName = displayName.replace(/[\r\n"]/g, '').trim() || PLATFORM_FROM_NAME;
  const cleanAddr = address.replace(/[\r\n<>]/g, '').trim();
  return `${cleanName} <${cleanAddr}>`;
}

/**
 * Keep Reply-To on the same org as From so filters do not treat the
 * message as a spoof. jack@jettx.ai on hello@invites.jettx.ai is fine.
 * A yahoo.com Reply-To on a jettx.ai From is not.
 */
export function alignedReplyTo(
  fromAddress: string,
  requested?: string | null,
): string | null {
  const reply = requested?.trim() || null;
  if (!reply) return null;
  const address = reply.includes('<')
    ? (reply.match(/<([^>]+)>/)?.[1] ?? reply)
    : reply;
  if (sameOrganization(fromAddress, address)) return reply;
  return null;
}

export function smtpFromMatchesAccount(
  fromAddress: string,
  smtpUser?: string | null,
): boolean {
  const user = smtpUser?.trim();
  if (!user) return false;
  return sameOrganization(fromAddress, user);
}

export interface DeliverabilityHeadersInput {
  kind: MailKind;
  sendId?: string | null;
  unsubscribeUrl?: string | null;
}

export function deliverabilityHeaders(
  input: DeliverabilityHeadersInput,
): Record<string, string> {
  const sendId = (input.sendId?.trim() || randomUUID()).replace(/[\r\n]/g, '');
  const headers: Record<string, string> = {
    'X-Entity-Ref-ID': sendId,
  };
  if (input.kind === 'transactional') {
    headers['Auto-Submitted'] = 'auto-generated';
  }
  const unsub = input.unsubscribeUrl?.trim();
  if (unsub && input.kind === 'marketing') {
    headers['List-Unsubscribe'] = `<${unsub.replace(/[\r\n<>]/g, '')}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return headers;
}

export function resendTags(kind: MailKind): Array<{ name: string; value: string }> {
  return [
    { name: 'category', value: kind },
    { name: 'product', value: 'atmosphere' },
  ];
}

/** DMARC record receivers require in 2024+ even at p=none. */
export function recommendedDmarcTxt(ruaEmail: string): string {
  const rua = ruaEmail.trim().toLowerCase();
  return `v=DMARC1; p=none; rua=mailto:${rua}; fo=1; adkim=r; aspf=r`;
}

export interface DnsAuthFinding {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/**
 * Score the public jettx.ai records that decide inbox vs junk.
 * The live zone (2026-09) is missing DMARC on both apex and invites,
 * and has no Google Workspace DKIM — that is why jack@jettx.ai lands
 * in spam when it goes out through Gmail SMTP.
 */
export function evaluateEmailAuthDns(input: {
  apexTxt: string[];
  apexDmarc: string[];
  invitesDmarc: string[];
  invitesDkim: string[];
  googleDkim: string[];
  sendInvitesSpf: string[];
}): DnsAuthFinding[] {
  const findings: DnsAuthFinding[] = [];

  const apexHasSpf = input.apexTxt.some((t) => /\bv=spf1\b/i.test(t));
  findings.push({
    name: 'apex-spf',
    ok: apexHasSpf,
    detail: apexHasSpf
      ? 'jettx.ai publishes SPF.'
      : 'jettx.ai has no SPF record.',
  });

  const dmarc = input.apexDmarc.find((t) => /\bv=DMARC1\b/i.test(t));
  findings.push({
    name: 'apex-dmarc',
    ok: Boolean(dmarc),
    detail: dmarc
      ? `_dmarc.jettx.ai is ${dmarc}`
      : 'jettx.ai has no DMARC record. Gmail, Yahoo, and Outlook treat unauthenticated mail as junk.',
    fix: dmarc ? undefined : `TXT  _dmarc  ${recommendedDmarcTxt('jack@jettx.ai')}`,
  });

  const invitesDmarc = input.invitesDmarc.find((t) => /\bv=DMARC1\b/i.test(t));
  findings.push({
    name: 'invites-dmarc',
    ok: Boolean(invitesDmarc),
    detail: invitesDmarc
      ? `_dmarc.invites.jettx.ai is ${invitesDmarc}`
      : 'invites.jettx.ai (Resend From) has no DMARC record.',
    fix: invitesDmarc
      ? undefined
      : `TXT  _dmarc.invites  ${recommendedDmarcTxt('jack@jettx.ai')}`,
  });

  const dkim = input.invitesDkim.find((t) => /\bp=/.test(t));
  findings.push({
    name: 'invites-dkim',
    ok: Boolean(dkim),
    detail: dkim
      ? 'resend._domainkey.invites.jettx.ai is published.'
      : 'resend._domainkey.invites.jettx.ai is missing — Resend DKIM will fail.',
  });

  const googleDkim = input.googleDkim.some((t) => /\bp=[A-Za-z0-9]/i.test(t));
  findings.push({
    name: 'google-dkim',
    ok: googleDkim,
    detail: googleDkim
      ? 'Google Workspace DKIM is published.'
      : 'google._domainkey.jettx.ai is missing. Mail sent as jack@jettx.ai through Gmail / Workspace SMTP fails DKIM and lands in junk.',
    fix: googleDkim
      ? undefined
      : 'Google Admin → Apps → Gmail → Authenticate email → Generate new record → publish the TXT at google._domainkey.',
  });

  const sendSpf = input.sendInvitesSpf.some((t) => /\bv=spf1\b/i.test(t));
  findings.push({
    name: 'resend-return-path-spf',
    ok: sendSpf,
    detail: sendSpf
      ? 'send.invites.jettx.ai publishes SPF for Amazon SES (Resend).'
      : 'send.invites.jettx.ai has no SPF; the Resend return-path will fail.',
  });

  return findings;
}

/**
 * Resend is the authenticated path (DKIM on invites.jettx.ai, SES return-path).
 * SMTP is only first when an operator forces SYSTEM_MAIL_DRIVER=smtp.
 */
export function preferResendOverSmtp(input: {
  driver?: string | null;
  resendApiKey?: string | null;
}): boolean {
  const driver = (input.driver ?? '').trim().toLowerCase();
  if (driver === 'smtp' || driver === 'log' || driver === 'off') return false;
  return Boolean(input.resendApiKey?.trim());
}

export type MailTransport = 'resend' | 'smtp' | 'log';

export function systemMailTransportOrder(input: {
  driver?: string | null;
  resendReady: boolean;
  smtpReady: boolean;
  logReady: boolean;
}): MailTransport[] {
  const driver = (input.driver ?? '').trim().toLowerCase();
  const out: MailTransport[] = [];
  const push = (name: MailTransport, ready: boolean) => {
    if (ready && !out.includes(name)) out.push(name);
  };

  if (driver === 'log') {
    push('log', input.logReady);
    return out;
  }
  if (driver === 'smtp') {
    push('smtp', input.smtpReady);
    push('resend', input.resendReady);
    push('log', input.logReady);
    return out;
  }
  if (driver === 'resend') {
    push('resend', input.resendReady);
    push('log', input.logReady);
    return out;
  }

  push('resend', input.resendReady);
  push('smtp', input.smtpReady);
  push('log', input.logReady);
  return out;
}
