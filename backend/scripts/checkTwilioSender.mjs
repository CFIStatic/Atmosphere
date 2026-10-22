#!/usr/bin/env node
/**
 * Can the backend text invite links? Reads the Twilio vars from the live
 * Railway service (where the backend gets them), then asks Twilio, read-only,
 * whether the account and sender can send. Prints yes/no and counts only —
 * never a value — and always exits 0: a missing sender is a warning, not a
 * failed deploy.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const warn = (msg) => console.log(`::warning title=Invite texts::${msg}`);

function railwayVars() {
  const wanted = process.env.RAILWAY_SERVICE?.trim() || 'Atmosphere APIs';
  const resolved = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./resolveRailwayService.mjs', import.meta.url)), wanted],
    { encoding: 'utf8', env: process.env },
  );
  const service = resolved.status === 0 && resolved.stdout?.trim() ? resolved.stdout.trim() : wanted;
  // stdout is captured, never echoed: it holds every secret on the service.
  const res = spawnSync('railway', ['variables', '--service', service, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

async function twilio(url, sid, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const vars = railwayVars();
  if (!vars) {
    warn('Could not read the backend variables on Railway, so the Twilio check was skipped.');
    return;
  }
  const get = (name) => String(vars[name] ?? '').trim();
  const sid = get('TWILIO_ACCOUNT_SID');
  const token = get('TWILIO_AUTH_TOKEN');
  const service = get('TWILIO_MESSAGING_SERVICE_SID');
  const from = get('TWILIO_FROM_NUMBER');
  console.log(
    `Railway backend: TWILIO_ACCOUNT_SID ${sid ? 'set' : 'missing'}, TWILIO_AUTH_TOKEN ${token ? 'set' : 'missing'}, ` +
      `TWILIO_MESSAGING_SERVICE_SID ${service ? 'set' : 'missing'}, TWILIO_FROM_NUMBER ${from ? 'set' : 'missing'}`,
  );
  if (!sid || !token) {
    warn('Invite texts are off: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not on the backend. Add them to GitHub Keys.');
    return;
  }
  if (!service && !from) {
    warn('Invite texts are off: no Twilio sender. Add TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM_NUMBER) to GitHub Keys.');
    return;
  }

  const account = await twilio(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, sid, token);
  if (!account.ok) {
    warn(`Twilio rejected the account credentials (HTTP ${account.status}).`);
    return;
  }
  console.log(`Twilio account: status ${account.json.status}, type ${account.json.type}`);
  if (account.json.status !== 'active') warn(`Twilio account is ${account.json.status}, not active.`);
  if (account.json.type === 'Trial') warn('Twilio account is a Trial: it can only text numbers verified in the Twilio console.');

  if (service) {
    const base = `https://messaging.twilio.com/v1/Services/${encodeURIComponent(service)}`;
    const numbers = await twilio(`${base}/PhoneNumbers?PageSize=50`, sid, token);
    if (!numbers.ok) {
      warn(`Twilio could not find the Messaging Service (HTTP ${numbers.status}).`);
      return;
    }
    const count = (numbers.json.phone_numbers ?? []).length;
    console.log(`Messaging Service: ${count} sender number(s)`);
    if (!count) warn('The Twilio Messaging Service has no phone number in its sender pool.');
    const a2p = await twilio(`${base}/Compliance/Usa2p?PageSize=20`, sid, token);
    const campaigns = a2p.ok ? (a2p.json.compliance ?? []) : [];
    const verified = campaigns.filter((c) => String(c.campaign_status).toUpperCase() === 'VERIFIED').length;
    console.log(`US A2P 10DLC: ${campaigns.length} campaign(s), ${verified} verified`);
    if (!verified) warn('No verified US A2P 10DLC campaign on the Messaging Service: US carriers will block or filter invite texts.');
  } else {
    const found = await twilio(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`,
      sid,
      token,
    );
    const owned = found.ok && (found.json.incoming_phone_numbers ?? []).length > 0;
    console.log(`TWILIO_FROM_NUMBER ${owned ? 'is' : 'is not'} a number on this Twilio account`);
    if (!owned) warn('TWILIO_FROM_NUMBER is not a number on this Twilio account.');
  }
}

main().catch((err) => warn(`Twilio check failed: ${err instanceof Error ? err.message : 'unknown error'}`));
