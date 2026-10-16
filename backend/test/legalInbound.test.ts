import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import {
  inboundSecretMatches,
  listLegalRequests,
  resetLegalRequestsForTests,
} from '../src/legal/inbound.js';

process.env.LEGAL_STORE = 'memory';
const SECRET = 'test-legal-inbound-secret-0123456789';

async function withServer(fn: (base: string) => Promise<void>) {
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const payload = {
  messageId: '<abc123@mail.example.com>',
  from: 'counsel@lawfirm.example',
  fromName: 'Jane Counsel',
  to: 'legal@atmosphereteam.com',
  subject: 'Preservation request – 12 Oak St',
  text: 'Please preserve all footage for 12 Oak St, Sept 1–5, case 2026-CV-001.',
  receivedAt: '2026-10-16T23:00:00.000Z',
  rawSize: 2048,
  attachments: [{ filename: 'letter.pdf', contentType: 'application/pdf', size: 1024 }],
};

test('inboundSecretMatches is closed without a configured secret', () => {
  assert.equal(inboundSecretMatches('anything', ''), false);
  assert.equal(inboundSecretMatches('anything', undefined), false);
  assert.equal(inboundSecretMatches(undefined, SECRET), false);
  assert.equal(inboundSecretMatches('wrong', SECRET), false);
  assert.equal(inboundSecretMatches(SECRET, SECRET), true);
});

test('POST /api/legal/inbound rejects missing or wrong secret', async () => {
  process.env.LEGAL_INBOUND_SECRET = SECRET;
  resetLegalRequestsForTests();
  await withServer(async (base) => {
    for (const headers of [{}, { 'x-legal-inbound-secret': 'nope' }]) {
      const res = await fetch(`${base}/api/legal/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 401);
    }
  });
  assert.equal((await listLegalRequests()).length, 0);
});

test('POST /api/legal/inbound stores the request once and is idempotent', async () => {
  process.env.LEGAL_INBOUND_SECRET = SECRET;
  resetLegalRequestsForTests();
  await withServer(async (base) => {
    const post = () =>
      fetch(`${base}/api/legal/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-legal-inbound-secret': SECRET },
        body: JSON.stringify(payload),
      });
    const first = await post();
    assert.equal(first.status, 201);
    const body = (await first.json()) as { id: string; duplicate: boolean };
    assert.equal(body.duplicate, false);
    const again = await post();
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { id: string }).id, body.id);
  });
  const rows = await listLegalRequests();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromAddress, 'counsel@lawfirm.example');
  assert.equal(rows[0].status, 'new');
  assert.equal(rows[0].attachments[0].filename, 'letter.pdf');
});

test('POST /api/legal/inbound validates the payload', async () => {
  process.env.LEGAL_INBOUND_SECRET = SECRET;
  resetLegalRequestsForTests();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/legal/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-legal-inbound-secret': SECRET },
      body: JSON.stringify({ subject: 'no sender' }),
    });
    assert.equal(res.status, 400);
  });
});

test('GET /api/legal/requests stays staff-only', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/legal/requests`);
    assert.ok(res.status === 401 || res.status === 403, `got ${res.status}`);
  });
});
