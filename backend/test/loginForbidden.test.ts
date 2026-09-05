import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { blockIp, unblockIp } from '../src/cyber/blocker.js';

async function listen(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

test('POST /api/auth/login is never cyber Forbidden after an IP ban', async () => {
  const { url, close } = await listen();
  try {
    blockIp({
      ip: '127.0.0.1',
      reason: 'honeypot',
      score: 90,
      severity: 'high',
      deceived: true,
    });
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5174',
      },
      body: JSON.stringify({ email: 'jack@jettx.ai', password: 'password12' }),
    });
    const body = (await res.json()) as { error?: string; code?: string };
    assert.notEqual(body.error, 'Forbidden');
    assert.notEqual(body.code, 'blocked');
    assert.notEqual(body.code, 'cors_origin_denied');
    assert.ok(
      res.status === 401 || res.status === 400 || res.status === 503,
      `login should reach auth, got ${res.status} ${body.code} ${body.error}`,
    );
  } finally {
    unblockIp('127.0.0.1');
    await close();
  }
});
