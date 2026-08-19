import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET / is live so the Railway domain link is not a 404', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status?: string;
      service?: string;
      health?: string;
      ready?: string;
    };
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'atmosphere-backend');
    assert.equal(body.health, '/api/health');
    assert.equal(body.ready, '/api/ready');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('GET /api/health is live without touching Supabase', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string; service?: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'atmosphere-backend');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
