import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSmsNumber, sendSms, smsProviderConfigured } from '../src/shared/smsProvider.js';

test('normalizeSmsNumber: US 10-digit and E.164', () => {
  assert.equal(normalizeSmsNumber('555-010-0001'), '+15550100001');
  assert.equal(normalizeSmsNumber('(555) 010-0001'), '+15550100001');
  assert.equal(normalizeSmsNumber('+44 7700 900123'), '+447700900123');
  assert.equal(normalizeSmsNumber(''), null);
});

test('SMS: not configured refuses; configured posts to Twilio', async () => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
  assert.equal(smsProviderConfigured(), false);
  const off = await sendSms({ to: '+15550100', body: 'Status check' });
  assert.equal(off.ok, false);
  if (off.ok) return;
  assert.equal(off.reason, 'not_configured');

  process.env.TWILIO_ACCOUNT_SID = 'ACtestsid000000000000000000000000';
  process.env.TWILIO_AUTH_TOKEN = 'testtoken';
  process.env.TWILIO_FROM_NUMBER = '+15551234567';
  assert.equal(smsProviderConfigured(), true);

  const original = globalThis.fetch;
  let posted: { url: string; auth: string; body: string } | null = null;
  globalThis.fetch = (async (url: any, init?: any) => {
    posted = {
      url: String(url),
      auth: String(init?.headers?.Authorization ?? ''),
      body: String(init?.body ?? ''),
    };
    return new Response(JSON.stringify({ sid: 'SMxxxxxxxx' }), { status: 201 });
  }) as typeof fetch;
  try {
    const on = await sendSms({ to: '555-010-0001', body: 'Hello from the job.' });
    assert.equal(on.ok, true);
    if (!on.ok) return;
    assert.equal(on.provider, 'twilio');
    assert.equal(on.id, 'SMxxxxxxxx');
    assert.ok(posted);
    assert.match(posted!.url, /api\.twilio\.com.*Messages\.json/);
    assert.match(posted!.auth, /^Basic /);
    assert.match(posted!.body, /To=%2B15550100001/);
    assert.match(posted!.body, /From=%2B15551234567/);
    assert.match(posted!.body, /Body=Hello/);
  } finally {
    globalThis.fetch = original;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  }
});
