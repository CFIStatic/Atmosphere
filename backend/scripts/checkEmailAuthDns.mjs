#!/usr/bin/env node
/**
 * Public-DNS check for why jettx.ai mail lands in junk.
 *
 * Reads the live zone (no Resend API key required) and prints the records
 * that are missing. Deploy calls this after ensureResendSendingDomain so
 * the GoDaddy work is visible in the job log.
 *
 * Plain node — no tsx — so the production deploy job can run it without
 * installing backend dependencies. Scoring rules stay in
 * backend/src/lib/mailDeliverability.ts; keep the two lists in sync.
 *
 * Never fails the deploy — missing records log and exit 0.
 */
import { resolveTxt } from 'node:dns/promises';

const APEX = 'jettx.ai';
const RUA = 'jack@jettx.ai';
const DMARC = `v=DMARC1; p=none; rua=mailto:${RUA}; fo=1; adkim=r; aspf=r`;

async function txt(name) {
  try {
    const rows = await resolveTxt(name);
    return rows.map((parts) => parts.join(''));
  } catch (err) {
    if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND' || err.code === 'NXDOMAIN')) {
      return [];
    }
    throw err;
  }
}

const [apexTxt, apexDmarc, invitesDmarc, invitesDkim, googleDkim, sendInvitesSpf] =
  await Promise.all([
    txt(APEX),
    txt(`_dmarc.${APEX}`),
    txt(`_dmarc.invites.${APEX}`),
    txt(`resend._domainkey.invites.${APEX}`),
    txt(`google._domainkey.${APEX}`),
    txt(`send.invites.${APEX}`),
  ]);

const findings = [
  {
    name: 'apex-spf',
    ok: apexTxt.some((t) => /\bv=spf1\b/i.test(t)),
    detail: apexTxt.some((t) => /\bv=spf1\b/i.test(t))
      ? 'jettx.ai publishes SPF.'
      : 'jettx.ai has no SPF record.',
  },
  {
    name: 'apex-dmarc',
    ok: apexDmarc.some((t) => /\bv=DMARC1\b/i.test(t)),
    detail: apexDmarc.some((t) => /\bv=DMARC1\b/i.test(t))
      ? `_dmarc.jettx.ai is ${apexDmarc.join(' ')}`
      : 'jettx.ai has no DMARC record. Gmail, Yahoo, and Outlook treat unauthenticated mail as junk.',
  },
  {
    name: 'invites-dmarc',
    ok: invitesDmarc.some((t) => /\bv=DMARC1\b/i.test(t)),
    detail: invitesDmarc.some((t) => /\bv=DMARC1\b/i.test(t))
      ? `_dmarc.invites.jettx.ai is ${invitesDmarc.join(' ')}`
      : 'invites.jettx.ai (Resend From) has no DMARC record.',
  },
  {
    name: 'invites-dkim',
    ok: invitesDkim.some((t) => /\bp=/.test(t)),
    detail: invitesDkim.some((t) => /\bp=/.test(t))
      ? 'resend._domainkey.invites.jettx.ai is published.'
      : 'resend._domainkey.invites.jettx.ai is missing — Resend DKIM will fail.',
  },
  {
    name: 'google-dkim',
    ok: googleDkim.some((t) => /\bp=[A-Za-z0-9]/i.test(t)),
    detail: googleDkim.some((t) => /\bp=[A-Za-z0-9]/i.test(t))
      ? 'Google Workspace DKIM is published.'
      : 'google._domainkey.jettx.ai is missing. Mail sent as jack@jettx.ai through Gmail / Workspace SMTP fails DKIM and lands in junk.',
  },
  {
    name: 'resend-return-path-spf',
    ok: sendInvitesSpf.some((t) => /\bv=spf1\b/i.test(t)),
    detail: sendInvitesSpf.some((t) => /\bv=spf1\b/i.test(t))
      ? 'send.invites.jettx.ai publishes SPF for Amazon SES (Resend).'
      : 'send.invites.jettx.ai has no SPF; the Resend return-path will fail.',
  },
];

const missing = findings.filter((f) => !f.ok);
console.log('jettx.ai email authentication (public DNS)');
for (const finding of findings) {
  console.log(`  ${finding.ok ? 'ok ' : 'FIX'}  ${finding.name} — ${finding.detail}`);
}

if (missing.length === 0) {
  console.log('All checked records are present.');
  process.exit(0);
}

console.log('');
console.log('Add these at GoDaddy (DNS → jettx.ai → Records). Nameservers are ns07/ns08.domaincontrol.com.');
console.log('Leave existing Google MX and the GoDaddy SPF include alone.');
console.log('');
console.log(`  TXT   _dmarc            ${DMARC}`);
console.log(`  TXT   _dmarc.invites    ${DMARC}`);
console.log('');
console.log('Then in Google Admin → Apps → Gmail → Authenticate email:');
console.log('  Generate a DKIM key for jettx.ai and publish the TXT at google._domainkey');
console.log('');
console.log('Without DMARC + Google DKIM, mail sent as jack@jettx.ai (Gmail UI or SMTP)');
console.log('fails authentication and Gmail / Outlook / Yahoo put it in junk.');
process.exit(0);
