import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const OFFICE_ORIGIN = 'https://atmosphere-web-production.up.railway.app';
const PLATFORM_ORIGIN = 'https://platform.atmosphereteam.com';
const FIELD_CAPTURE_ORIGIN = 'https://field-capture-production.up.railway.app';

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

test('CORS allows the Atmosphere-web Railway origin', async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: OFFICE_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.notEqual(res.status, 500);
    assert.ok(res.status === 204 || res.status === 200);
    assert.equal(res.headers.get('access-control-allow-origin'), OFFICE_ORIGIN);
  } finally {
    await close();
  }
});

test('CORS allows the live platform.atmosphereteam.com origin', async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: PLATFORM_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.notEqual(res.status, 500);
    assert.ok(res.status === 204 || res.status === 200);
    assert.equal(res.headers.get('access-control-allow-origin'), PLATFORM_ORIGIN);
  } finally {
    await close();
  }
});

test('CORS allows the Field Capture Railway origin', async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/field-app/join`, {
      method: 'OPTIONS',
      headers: {
        Origin: FIELD_CAPTURE_ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.notEqual(res.status, 500);
    assert.ok(res.status === 204 || res.status === 200);
    assert.equal(res.headers.get('access-control-allow-origin'), FIELD_CAPTURE_ORIGIN);
  } finally {
    await close();
  }
});

test('CORS denial is 403, not Internal server error', async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/auth/me`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; code?: string };
    assert.equal(body.code, 'cors_origin_denied');
    assert.notEqual(body.error, 'Internal server error');
  } finally {
    await close();
  }
});
