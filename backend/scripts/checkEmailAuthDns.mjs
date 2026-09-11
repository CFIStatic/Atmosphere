#!/usr/bin/env node
/**
 * Public-DNS check for atmosphereteam.com transactional mail auth.
 *
 * Reads the live zone (no Resend API key required) and prints the records
 * that are missing. Deploy calls this after ensureResendSendingDomain so
 * the Cloudflare work is visible in the job log.
 *
 * Plain node — no tsx — so the production deploy job can run it without
 * installing backend dependencies. Scoring rules stay in
 * backend/src/lib/mailDeliverability.ts; keep the two lists in sync.
 *
 * Never fails the deploy — missing records log and exit 0.
 */
import { resolveTxt } from 'node:dns/promises';

const APEX = 'atmosphereteam.com';
const RUA = 'hello@atmosphereteam.com';
const DMARC = `v=DMARC1; p=none; rua=mailto:${RUA}; fo=1; adkim=r; aspf=r`;

async function txt(name) {
  try {
    const rows = await resolveTxt(name);
    return rows.map((parts) => parts.join(''));
  } catch (err) {
    // Missing records and transient resolver failures (ETIMEOUT, ESERVFAIL,
    // ENETUNREACH, …) are advisory — this script never fails the deploy.
    if (err && err.code && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND' && err.code !== 'NXDOMAIN') {
      console.warn(`  DNS lookup failed for ${name}: ${err.code}`);
    }
    return [];
  }
}

const [apexTxt, apexDmarc, invitesDmarc, invitesDkim, sendInvitesSpf] =
  await Promise.all([
    txt(APEX),
    txt(`_dmarc.${APEX}`),
    txt(`_dmarc.invites.${APEX}`),
    txt(`resend._domainkey.invites.${APEX}`),
    txt(`send.invites.${APEX}`),
  ]);

const findings = [
  {
    name: 'apex-spf',
    ok: apexTxt.some((t) => /\bv=spf1\b/i.test(t)),
    detail: apexTxt.some((t) => /\bv=spf1\b/i.test(t))
      ? 'atmosphereteam.com publishes SPF (Cloudflare Email Routing — do not add Resend).'
      : 'atmosphereteam.com has no SPF record.',
  },
  {
    name: 'apex-dmarc',
    ok: apexDmarc.some((t) => /\bv=DMARC1\b/i.test(t)),
    detail: apexDmarc.some((t) => /\bv=DMARC1\b/i.test(t))
      ? `_dmarc.atmosphereteam.com is ${apexDmarc.join(' ')}`
      : 'atmosphereteam.com has no DMARC record. Gmail, Yahoo, and Outlook treat unauthenticated mail as junk.',
  },
  {
    name: 'invites-dmarc',
    ok: invitesDmarc.some((t) => /\bv=DMARC1\b/i.test(t)),
    detail: invitesDmarc.some((t) => /\bv=DMARC1\b/i.test(t))
      ? `_dmarc.invites.atmosphereteam.com is ${invitesDmarc.join(' ')}`
      : 'invites.atmosphereteam.com (Resend From) has no DMARC record.',
  },
  {
    name: 'invites-dkim',
    ok: invitesDkim.some((t) => /\bp=/.test(t)),
    detail: invitesDkim.some((t) => /\bp=/.test(t))
      ? 'resend._domainkey.invites.atmosphereteam.com is published.'
      : 'resend._domainkey.invites.atmosphereteam.com is missing — Resend DKIM will fail.',
  },
  {
    name: 'resend-return-path-spf',
    ok: sendInvitesSpf.some((t) => /\bv=spf1\b/i.test(t)),
    detail: sendInvitesSpf.some((t) => /\bv=spf1\b/i.test(t))
      ? 'send.invites.atmosphereteam.com publishes SPF for Amazon SES (Resend).'
      : 'send.invites.atmosphereteam.com has no SPF; the Resend return-path will fail.',
  },
];

const missing = findings.filter((f) => !f.ok);
console.log('atmosphereteam.com email authentication (public DNS)');
for (const finding of findings) {
  console.log(`  ${finding.ok ? 'ok ' : 'FIX'}  ${finding.name} — ${finding.detail}`);
}

if (missing.length === 0) {
  console.log('All checked records are present.');
  process.exit(0);
}

console.log('');
console.log('Add missing records in Cloudflare DNS for atmosphereteam.com.');
console.log('Do not put Resend in apex SPF — Cloudflare Email Routing owns apex SPF/MX.');
console.log('Resend authenticates on send.invites.atmosphereteam.com only.');
console.log('');
console.log(`  TXT   _dmarc            ${DMARC}`);
console.log(`  TXT   _dmarc.invites    ${DMARC}`);
console.log('');
console.log('Also publish the Resend DKIM + return-path records from the Resend dashboard');
console.log('for invites.atmosphereteam.com, and turn click tracking OFF.');
process.exit(0);
