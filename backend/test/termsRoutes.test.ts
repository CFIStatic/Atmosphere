import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_TERMS_VERSION, TERMS_PUBLIC_URL } from '../src/legal/terms.js';
import { signupCredentialsSchema } from '../src/lib/validation.js';

test('GET /api/auth/terms returns the live version and public URL', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/terms`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { currentVersion?: string; url?: string };
    assert.equal(body.currentVersion, CURRENT_TERMS_VERSION);
    assert.equal(body.url, TERMS_PUBLIC_URL);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/auth/signup rejects a missing Terms acknowledgment before Auth', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new@office.example',
        password: 'long-enough',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; code?: string };
    assert.match(body.error ?? '', /Terms of Service/i);
    assert.equal(body.code, 'validation_error');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/auth/terms/accept requires a session', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/terms/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptedTermsVersion: CURRENT_TERMS_VERSION }),
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('signup credentials require the live terms version string', () => {
  const parsed = signupCredentialsSchema.parse({
    email: 'new@office.example',
    password: 'long-enough',
    acceptedTermsVersion: ` ${CURRENT_TERMS_VERSION} `,
  });
  assert.equal(parsed.acceptedTermsVersion, CURRENT_TERMS_VERSION);
  assert.throws(() =>
    signupCredentialsSchema.parse({
      email: 'new@office.example',
      password: 'long-enough',
    }),
  );
});
