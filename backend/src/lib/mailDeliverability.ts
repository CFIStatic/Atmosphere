/**
 * Headers and sender rules that keep Atmosphere mail out of junk.
 *
 * Inbox placement is mostly DNS (SPF / DKIM / DMARC on atmosphereteam.com).
 * This module is the part the app controls: a unique entity id so Gmail does
 * not thread every invite together, Auto-Submitted so filters treat OTPs
 * as transactional, and a From / Reply-To pair that stays inside the same
 * organizational domain.
 */

import { randomUUID } from 'node:crypto';
import { emailDomain } from './resendFrom.js';

export const PLATFORM_FROM_NAME = 'Atmosphere';

export type MailKind = 'transactional' | 'marketing';

const MULTI_PART_PUBLIC_SUFFIXES = new Set(['co.uk', 'com.au', 'co.nz', 'com.br', 'co.jp']);

/**
 * Cheap eTLD+1. `.ai` / `.com` are normal TLDs (not two-label suffixes).
 * invites.atmosphereteam.com and hello@atmosphereteam.com are the same org;
 * invites.jettx.ai and jack@jettx.ai likewise (legacy).
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
 * message as a spoof. hello@atmosphereteam.com on hello@invites.atmosphereteam.com
 * is fine. jack@jettx.ai on an Atmosphere From is not (different org) and
 * alignedReplyTo will drop it.
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
  // SES / Postmark / SendGrid SMTP logins are access keys or tokens, not
  // mailboxes. Those hosts authenticate From via SPF/DKIM on the account,
  // not via the username domain.
  if (!emailDomain(user)) return true;
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
 * Score the public atmosphereteam.com records that decide inbox vs junk.
 * Apex SPF is owned by Cloudflare Email Routing — do not add Resend there.
 * Resend authenticates on send.invites.atmosphereteam.com only.
 */
export function evaluateEmailAuthDns(input: {
  apexTxt: string[];
  apexDmarc: string[];
  invitesDmarc: string[];
  invitesDkim: string[];
  sendInvitesSpf: string[];
}): DnsAuthFinding[] {
  const findings: DnsAuthFinding[] = [];

  const apexHasSpf = input.apexTxt.some((t) => /\bv=spf1\b/i.test(t));
  findings.push({
    name: 'apex-spf',
    ok: apexHasSpf,
    detail: apexHasSpf
      ? 'atmosphereteam.com publishes SPF (Cloudflare Email Routing — do not add Resend).'
      : 'atmosphereteam.com has no SPF record.',
  });

  const dmarc = input.apexDmarc.find((t) => /\bv=DMARC1\b/i.test(t));
  findings.push({
    name: 'apex-dmarc',
    ok: Boolean(dmarc),
    detail: dmarc
      ? `_dmarc.atmosphereteam.com is ${dmarc}`
      : 'atmosphereteam.com has no DMARC record. Gmail, Yahoo, and Outlook treat unauthenticated mail as junk.',
    fix: dmarc ? undefined : `TXT  _dmarc  ${recommendedDmarcTxt('hello@atmosphereteam.com')}`,
  });

  const invitesDmarc = input.invitesDmarc.find((t) => /\bv=DMARC1\b/i.test(t));
  findings.push({
    name: 'invites-dmarc',
    ok: Boolean(invitesDmarc),
    detail: invitesDmarc
      ? `_dmarc.invites.atmosphereteam.com is ${invitesDmarc}`
      : 'invites.atmosphereteam.com (Resend From) has no DMARC record.',
    fix: invitesDmarc
      ? undefined
      : `TXT  _dmarc.invites  ${recommendedDmarcTxt('hello@atmosphereteam.com')}`,
  });

  const dkim = input.invitesDkim.find((t) => /\bp=/.test(t));
  findings.push({
    name: 'invites-dkim',
    ok: Boolean(dkim),
    detail: dkim
      ? 'resend._domainkey.invites.atmosphereteam.com is published.'
      : 'resend._domainkey.invites.atmosphereteam.com is missing — Resend DKIM will fail.',
  });

  const sendSpf = input.sendInvitesSpf.some((t) => /\bv=spf1\b/i.test(t));
  findings.push({
    name: 'resend-return-path-spf',
    ok: sendSpf,
    detail: sendSpf
      ? 'send.invites.atmosphereteam.com publishes SPF for Amazon SES (Resend).'
      : 'send.invites.atmosphereteam.com has no SPF; the Resend return-path will fail.',
  });

  return findings;
}

/** Resend first unless SYSTEM_MAIL_DRIVER forces smtp/log. */
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
