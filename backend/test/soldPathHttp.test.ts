import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { allLeftoverSurfaces } from '../src/lib/platformSurfaces.js';

/**
 * HTTP contract for the sold Work Verification path.
 *
 * These requests do not need a live session. They fail in a specific,
 * documented way when a route is remounted, unmounted, or left unguarded.
 * That is the point: a BFF regression should break this file, not production.
 */

async function listen(leftoverOff = true): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = leftoverOff
    ? createApp({ leftoverSurfaces: allLeftoverSurfaces(false) })
    : createApp({ leftoverSurfaces: allLeftoverSurfaces(true) });
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

async function json(
  url: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

const LEFTOVER_PATHS = [
  '/api/sales',
  '/api/pm',
  '/api/estimator',
  '/api/computer',
  '/api/prospecting',
  '/api/email-marketing',
  '/api/finance',
  '/api/crm',
  '/api/cyber',
  '/api/technician',
  '/api/ai',
  '/api/web-access',
  '/api/purchasing',
  '/api/locations',
  '/api/backups',
  '/api/integrations',
  '/api/mitigation',
  '/api/xactimate',
  '/api/symbility',
  '/api/crm-sync',
];

test('leftover platform APIs return 404 platform_surface_disabled when gated', async () => {
  const { url, close } = await listen(true);
  try {
    for (const path of LEFTOVER_PATHS) {
      const { status, body } = await json(url, path);
      assert.equal(status, 404, `${path} should be gated`);
      assert.equal(body.code, 'platform_surface_disabled', `${path} code`);
    }
  } finally {
    await close();
  }
});

test('leftover APIs are reachable when explicitly enabled (local / preview)', async () => {
  const { url, close } = await listen(false);
  try {
    const { status, body } = await json(url, '/api/sales');
    assert.notEqual(body.code, 'platform_surface_disabled');
    // Sales is auth-gated once mounted — 401, 404 (no matching verb), or 400
    // are all fine. Disabled is not.
    assert.ok(status === 401 || status === 404 || status === 400, `got ${status}`);
  } finally {
    await close();
  }
});

test('sold path: health stays up with leftover surfaces gated', async () => {
  const { url, close } = await listen(true);
  try {
    const { status, body } = await json(url, '/api/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'atmosphere-backend');
  } finally {
    await close();
  }
});

test('sold path: login rejects an empty body (validation, not 404)', async () => {
  const { url, close } = await listen(true);
  try {
    const { status, body } = await json(url, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(status, 400);
    assert.equal(body.code, 'validation_error');
  } finally {
    await close();
  }
});

test('sold path: login → intake → share → proof mounts stay registered', async () => {
  const { url, close } = await listen(true);
  try {
    const login = await json(url, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
    });
    assert.equal(login.status, 400);
    assert.equal(login.body.code, 'validation_error');

    const org = await json(url, '/api/org/me');
    assert.equal(org.status, 401);
    assert.equal(org.body.code, 'unauthorized');

    const propose = await json(url, '/api/operations/intake/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '1842 Meridian Ave, Austin TX. Extract water.' }),
    });
    assert.equal(propose.status, 401);
    assert.equal(propose.body.code, 'unauthorized');

    const approve = await json(url, '/api/operations/intake/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Meridian', workType: 'mitigation' }),
    });
    assert.equal(approve.status, 401);
    assert.equal(approve.body.code, 'unauthorized');

    const exchange = await json(url, '/api/job-share/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(exchange.status, 400);
    assert.equal(exchange.body.code, 'validation_error');

    const progressExchange = await json(url, '/api/progress-share/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(progressExchange.status, 400);
    assert.equal(progressExchange.body.code, 'validation_error');

    const session = await json(url, '/api/job-share/session');
    assert.equal(session.status, 401);
    assert.equal(session.body.code, 'no_share_session');

    const progressSession = await json(url, '/api/progress-share/session');
    assert.equal(progressSession.status, 401);
    assert.equal(progressSession.body.code, 'no_share_session');

    const share = await json(url, '/api/job-share/not-a-real-token-xx');
    assert.ok(share.status === 404 || share.status === 503, `job-share got ${share.status}`);
    assert.ok(
      share.body.code === 'bad_token' ||
        share.body.code === 'no_admin' ||
        share.body.code === 'not_found',
      `job-share code ${String(share.body.code)}`,
    );

    const proof = await json(url, '/api/verification/usage');
    assert.equal(proof.status, 401);
    assert.equal(proof.body.code, 'unauthorized');

    const library = await json(url, '/api/evidence-portal/library');
    assert.equal(library.status, 401);
    assert.equal(library.body.code, 'unauthorized');

    const field = await json(url, '/api/field-app/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.ok(field.status === 400 || field.status === 401, `field-app got ${field.status}`);
    assert.notEqual(field.body.code, 'platform_surface_disabled');
    assert.notEqual(field.body.code, 'not_found');
  } finally {
    await close();
  }
});

test('sold path: Stripe webhook stays mounted (unsigned / unconfigured)', async () => {
  const { url, close } = await listen(true);
  try {
    const { status, body } = await json(url, '/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.ok(status === 503 || status === 400, `stripe webhook got ${status}`);
    assert.ok(
      body.code === 'webhook_unconfigured' || body.code === 'invalid_signature',
      `stripe code ${String(body.code)}`,
    );
  } finally {
    await close();
  }
});

test('CAN-SPAM unsubscribe stays mounted when email marketing is gated', async () => {
  const { url, close } = await listen(true);
  try {
    const res = await fetch(`${url}/api/unsubscribe`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /unsubscribed/i);
  } finally {
    await close();
  }
});
