/**
 * Browserbase adapter: connectUrl cache + GET /v1/sessions/{id} reconnect.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserbaseError, BrowserbaseProvider } from '../src/computer/providers/browserbase.js';

afterEach(() => {
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_PROJECT_ID;
});

function providerWithFetch(handler: (method: string, path: string, body?: unknown) => unknown) {
  process.env.BROWSERBASE_API_KEY = 'bb_test_key';
  process.env.BROWSERBASE_PROJECT_ID = 'proj_test';
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = u.pathname + u.search;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const out = handler(method, path, body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(out),
    } as Response;
  };
  const provider = new BrowserbaseProvider({ width: 1280, height: 800 }, fetchImpl as typeof fetch);
  return { provider, calls };
}

test('createSession caches connectUrl; after cache clear, resolve re-fetches from GET session', async () => {
  let sessionGet = 0;
  const { provider, calls } = providerWithFetch((method, path) => {
    if (method === 'POST' && path === '/v1/sessions') {
      return { id: 'sess_1', connectUrl: 'wss://connect.browserbase.com/sess_1', createdAt: '2026-10-06T12:00:00.000Z' };
    }
    if (method === 'GET' && path === '/v1/sessions/sess_1') {
      sessionGet += 1;
      return { id: 'sess_1', connectUrl: 'wss://connect.browserbase.com/sess_1_refetch', status: 'RUNNING' };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });

  const handle = await provider.createSession({ orgId: 'org', contextId: 'ctx_1', timeoutSec: 600 });
  assert.equal(handle.providerSessionId, 'sess_1');

  const cached = await provider.resolveConnectUrlForTests('sess_1');
  assert.equal(cached, 'wss://connect.browserbase.com/sess_1');
  assert.equal(sessionGet, 0, 'cache hit does not call GET');

  provider.clearConnectUrlCacheForTests();
  const refetched = await provider.resolveConnectUrlForTests('sess_1');
  assert.equal(refetched, 'wss://connect.browserbase.com/sess_1_refetch');
  assert.equal(sessionGet, 1);
  assert.ok(calls.some((c) => c.method === 'GET' && c.path === '/v1/sessions/sess_1'));
});

test('resolveConnectUrl fails clearly when GET session has no connectUrl', async () => {
  const { provider } = providerWithFetch((method, path) => {
    if (method === 'POST' && path === '/v1/sessions') {
      return { id: 'sess_dead', connectUrl: 'wss://connect.browserbase.com/x', createdAt: '2026-10-06T12:00:00.000Z' };
    }
    if (method === 'GET' && path === '/v1/sessions/sess_dead') {
      return { id: 'sess_dead', status: 'COMPLETED' };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  await provider.createSession({ orgId: 'org', contextId: 'ctx', timeoutSec: 60 });
  provider.clearConnectUrlCacheForTests();
  await assert.rejects(
    () => provider.resolveConnectUrlForTests('sess_dead'),
    (err: unknown) => {
      assert.ok(err instanceof BrowserbaseError);
      assert.equal(err.status, 410);
      assert.match(err.message, /unavailable|ended|restarted/i);
      return true;
    },
  );
});

test('createSession sends solveCaptchas:false, persist context, keepAlive false', async () => {
  const { provider, calls } = providerWithFetch((method, path) => {
    if (method === 'POST' && path === '/v1/sessions') {
      return { id: 'sess_2', connectUrl: 'wss://connect.browserbase.com/2', createdAt: '2026-10-06T12:00:00.000Z' };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  await provider.createSession({ orgId: 'org', contextId: 'ctx_persist', timeoutSec: 1800 });
  const body = calls[0].body as {
    browserSettings: { solveCaptchas: boolean; context: { id: string; persist: boolean } };
    keepAlive: boolean;
  };
  assert.equal(body.browserSettings.solveCaptchas, false);
  assert.equal(body.browserSettings.context.persist, true);
  assert.equal(body.browserSettings.context.id, 'ctx_persist');
  assert.equal(body.keepAlive, false);
});
