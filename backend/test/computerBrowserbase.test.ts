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

test('createSession adds no proxies by default, and an external office proxy when configured', async () => {
  const mk = () =>
    providerWithFetch((method, path) => {
      if (method === 'POST' && path === '/v1/sessions') return { id: 's', connectUrl: 'wss://c/1' };
      throw new Error(`unexpected ${method} ${path}`);
    });

  // Default: no egress config → no proxies field.
  delete process.env.COMPUTER_EGRESS;
  const a = mk();
  await a.provider.createSession({ orgId: 'org-a', contextId: 'ctx', timeoutSec: 60 });
  assert.equal((a.calls[0].body as { proxies?: unknown }).proxies, undefined);

  // External office proxy for this org; credentials are not in the server URL.
  process.env.COMPUTER_EGRESS = JSON.stringify({ 'org-a': { proxyUrl: 'http://u:p@office.example.com:3128' } });
  const b = mk();
  await b.provider.createSession({ orgId: 'org-a', contextId: 'ctx', timeoutSec: 60 });
  const proxies = (b.calls[0].body as { proxies?: Array<Record<string, string>> }).proxies;
  assert.deepEqual(proxies, [{ type: 'external', server: 'http://office.example.com:3128', username: 'u', password: 'p' }]);

  // A different org with no entry still gets the default egress.
  const c = mk();
  await c.provider.createSession({ orgId: 'org-other', contextId: 'ctx', timeoutSec: 60 });
  assert.equal((c.calls[0].body as { proxies?: unknown }).proxies, undefined);

  delete process.env.COMPUTER_EGRESS;
});

test('createSession pins the provider pool to the org region when geolocation is set', async () => {
  process.env.COMPUTER_EGRESS = JSON.stringify({ org: { geolocation: { city: 'Dallas', state: 'TX', country: 'us' } } });
  const { provider, calls } = providerWithFetch((method, path) => {
    if (method === 'POST' && path === '/v1/sessions') return { id: 's', connectUrl: 'wss://c/1' };
    throw new Error(`unexpected ${method} ${path}`);
  });
  await provider.createSession({ orgId: 'org', contextId: 'ctx', timeoutSec: 60 });
  const proxies = (calls[0].body as { proxies?: Array<Record<string, unknown>> }).proxies;
  assert.deepEqual(proxies, [{ type: 'browserbase', geolocation: { country: 'US', city: 'Dallas', state: 'TX' } }]);
  delete process.env.COMPUTER_EGRESS;
});
