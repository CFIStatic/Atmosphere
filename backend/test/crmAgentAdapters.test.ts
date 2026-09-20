import test from 'node:test';
import assert from 'node:assert/strict';
import { getCrmAdapter } from '../src/crm/agent/index.js';

test('JobNimbus verify falls back to agent_session when API rejects key', async () => {
  const adapter = getCrmAdapter('jobnimbus');
  const prev = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('unauthorized', { status: 401 })) as typeof fetch;
  try {
    const result = await adapter.verifyLogin({
      username: 'crew@example.com',
      password: 'not-an-api-key',
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'agent_session');
    assert.match(String(result.detail), /agent/i);
  } finally {
    globalThis.fetch = prev;
  }
});

test('Salesforce and ServiceTitan verify are agent_session stubs', async () => {
  for (const system of ['salesforce', 'servicetitan'] as const) {
    const result = await getCrmAdapter(system).verifyLogin({
      username: 'user@co.com',
      password: 'pw',
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'agent_session');
  }
});

test('AccuLynx verify returns agent_session for short passwords', async () => {
  const result = await getCrmAdapter('acculynx').verifyLogin({
    username: 'user@co.com',
    password: 'short',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'agent_session');
});
