import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sendSms, smsProviderConfigured } from '../src/shared/smsProvider.js';
import { orgInviteSms } from '../src/auth/phoneAuth.js';

const KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'TWILIO_MESSAGING_SERVICE_SID'];
const realFetch = globalThis.fetch;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});

describe('phone invite SMS', () => {
  it('is not configured with Verify-only creds (no sender)', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'x';
    delete process.env.TWILIO_FROM_NUMBER; delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    const fetchMock = mock.fn(async () => new Response('{}')); globalThis.fetch = fetchMock as unknown as typeof fetch;
    assert.equal(smsProviderConfigured(), false);
    const r = await sendSms({ to: '(555) 010-0000', body: 'hi' });
    assert.equal(r.ok, false); assert.equal(r.ok === false ? r.reason : null, 'not_configured');
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('sends the invite with link via messaging service (mocked Twilio)', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'x';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MGtest';
    const fetchMock = mock.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const body = orgInviteSms({ orgName: 'Acme', inviterName: 'Pat', link: 'https://app.atmosphereteam.com/login?invited=1' });
    assert.ok(body.includes('https://app.atmosphereteam.com/login'));
    const r = await sendSms({ to: '5550100000', body });
    assert.deepEqual(r, { ok: true, provider: 'twilio', id: 'SM1' });
    const form = new URLSearchParams(String(fetchMock.mock.calls[0].arguments[1].body));
    assert.equal(form.get('To'), '+15550100000');
    assert.equal(form.get('MessagingServiceSid'), 'MGtest');
    assert.equal(form.get('Body'), body);
  });
});
