#!/usr/bin/env node
/**
 * Make job-invite email actually leave Resend.
 *
 * Production should have RESEND_API_KEY and
 * RESEND_FROM_EMAIL=hello@invites.atmosphereteam.com.
 * Resend rejects that From until invites.atmosphereteam.com is a verified
 * domain (DKIM + return-path on a send. subdomain). Apex SPF/MX stay with
 * Cloudflare Email Routing — do not add Resend there. This script:
 *   1. Lists domains on the Keys Resend account
 *   2. Creates invites.atmosphereteam.com if it is missing
 *   3. Prints the DNS records to add in Cloudflare
 *   4. Triggers verification (no-op until DNS exists)
 *
 * Never fails the deploy — missing key or API errors log and exit 0.
 */
const apiKey = process.env.RESEND_API_KEY?.trim();
const TARGET = (process.env.RESEND_SENDING_DOMAIN ?? 'invites.atmosphereteam.com')
  .trim()
  .toLowerCase();

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
  console.log(`Add these DNS records in Cloudflare for ${TARGET}:`);
  console.log('  Type   Name                         Value');
  for (const rec of records) {
    const type = String(rec.type ?? '').padEnd(6);
    const name = String(rec.name ?? '').padEnd(28);
    const priority = rec.priority != null ? ` (priority ${rec.priority})` : '';
    const status = rec.status ? `  [${rec.status}]` : '';
    console.log(`  ${type} ${name} ${rec.value ?? ''}${priority}${status}`);
  }
  console.log('');
  console.log(
    'After DNS is in place, job invites can send to any crew inbox as hello@invites.atmosphereteam.com.',
  );
  console.log('Turn Resend click tracking OFF on this domain.');
  console.log('Do not put Resend in apex SPF — Cloudflare Email Routing owns apex SPF/MX.');
  console.log('Also add DMARC (see docs/email-deliverability.md) — without it Gmail/Yahoo junk the mail.');
  console.log('Until the sending domain is verified, Resend only delivers to the account owner.');
}


// Click/open tracking rewrites links through a tracking host — Yahoo/Gmail
// treat that as phishing-adjacent. Keep both OFF on the invite domain.
async function forceTrackingOff(domainId, domainName) {
  const updated = await resend(`/domains/${domainId}`, {
    method: 'PATCH',
    body: { open_tracking: false, click_tracking: false },
  });
  if (!updated.ok) {
    console.warn(
      `Could not disable Resend tracking on ${domainName} (${updated.status}):`,
      JSON.stringify(updated.json).slice(0, 300),
    );
    console.warn('Turn click + open tracking OFF manually: https://resend.com/domains');
    return;
  }
  console.log(`Resend tracking OFF for ${domainName} (open_tracking=false, click_tracking=false).`);
}

const listed = await resend('/domains');
if (!listed.ok) {
  if (listed.status === 401 && /restricted/i.test(JSON.stringify(listed.json))) {
    console.warn(
      'Resend API key is send-only — it can send mail but cannot create domains.',
    );
    console.warn(
      'Verify invites.atmosphereteam.com in the Resend dashboard: https://resend.com/domains',
    );
    console.warn('Add the DKIM + send.invites return-path records in Cloudflare DNS.');
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
await forceTrackingOff(domain.id, TARGET);
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
