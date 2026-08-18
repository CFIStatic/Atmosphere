#!/usr/bin/env node
/**
 * Make job-invite email actually leave Resend.
 *
 * Production already has RESEND_API_KEY and CAREERS_FROM_EMAIL=jack@jettx.ai.
 * Resend still rejects that From until jettx.ai is a verified domain (DKIM +
 * return-path on a send. subdomain, which does not disturb Google Workspace MX
 * on the apex). This script:
 *   1. Lists domains on the Keys Resend account
 *   2. Creates jettx.ai if it is missing
 *   3. Prints the DNS records to add at GoDaddy
 *   4. Triggers verification (no-op until DNS exists)
 *
 * Never fails the deploy — missing key or API errors log and exit 0.
 */
const apiKey = process.env.RESEND_API_KEY?.trim();
const TARGET = (process.env.RESEND_SENDING_DOMAIN ?? 'jettx.ai').trim().toLowerCase();

if (!apiKey) {
  console.warn('RESEND_API_KEY unset — skip Resend domain ensure.');
  process.exit(0);
}

async function resend(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.resend.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function printRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    console.log('No DNS records returned. Open https://resend.com/domains and copy them there.');
    return;
  }
  console.log('');
  console.log(`Add these DNS records at GoDaddy for ${TARGET} (nameservers ns07/ns08.domaincontrol.com):`);
  console.log('  Type   Name                         Value');
  for (const rec of records) {
    const type = String(rec.type ?? '').padEnd(6);
    const name = String(rec.name ?? '').padEnd(28);
    const priority = rec.priority != null ? ` (priority ${rec.priority})` : '';
    const status = rec.status ? `  [${rec.status}]` : '';
    console.log(`  ${type} ${name} ${rec.value ?? ''}${priority}${status}`);
  }
  console.log('');
  console.log('After DNS is in place, job invites can send to any crew inbox as jack@jettx.ai.');
  console.log('Until then Resend only delivers to the Resend account owner via onboarding@resend.dev.');
}

const listed = await resend('/domains');
if (!listed.ok) {
  if (listed.status === 401 && /restricted/i.test(JSON.stringify(listed.json))) {
    console.warn(
      'Resend API key is send-only — it can send mail but cannot create domains.',
    );
    console.warn('Verify jettx.ai in the Resend dashboard: https://resend.com/domains');
    console.warn(
      'Add the DKIM + send.jettx.ai MX/TXT records at GoDaddy (ns07/ns08.domaincontrol.com).',
    );
    console.warn(
      'Until that domain is verified, Resend only delivers to the account owner (onboarding@resend.dev).',
    );
    console.warn(
      'Optional: put a full-access Resend key in GitHub Keys as RESEND_API_KEY so deploy can create the domain.',
    );
  } else {
    console.warn(
      `Resend list domains failed (${listed.status}):`,
      JSON.stringify(listed.json).slice(0, 400),
    );
  }
  process.exit(0);
}

const domains = Array.isArray(listed.json?.data) ? listed.json.data : [];
console.log(
  'Resend domains:',
  domains.length
    ? domains.map((d) => `${d.name}=${d.status}`).join(', ')
    : '(none)',
);

let domain = domains.find((d) => String(d.name).toLowerCase() === TARGET);

if (!domain) {
  const created = await resend('/domains', {
    method: 'POST',
    body: { name: TARGET, region: 'us-east-1' },
  });
  if (!created.ok) {
    console.warn(
      `Resend create ${TARGET} failed (${created.status}):`,
      JSON.stringify(created.json).slice(0, 500),
    );
  } else {
    domain = created.json;
    console.log(`Created Resend domain ${TARGET} id=${domain?.id ?? '?'}`);
  }
}

if (!domain?.id) {
  process.exit(0);
}

const got = await resend(`/domains/${domain.id}`);
const status = got.json?.status ?? domain.status ?? 'unknown';
const records = got.json?.records ?? domain.records ?? [];
console.log(`Resend ${TARGET} status: ${status}`);
printRecords(records);

if (status !== 'verified') {
  const verified = await resend(`/domains/${domain.id}/verify`, { method: 'POST' });
  if (!verified.ok) {
    console.warn(
      `Resend verify ${TARGET} returned ${verified.status}:`,
      JSON.stringify(verified.json).slice(0, 300),
    );
  } else {
    console.log(`Triggered Resend verification for ${TARGET}.`);
  }
} else {
  console.log(`Resend domain ${TARGET} is verified — Approve & invite can email any inbox.`);
}
