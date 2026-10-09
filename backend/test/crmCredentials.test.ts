import test from 'node:test';
import assert from 'node:assert/strict';
import { sealCrmPassword, openCrmPassword, openCrmPasswordDetailed } from '../src/lib/crmCredentialCrypto.js';
import { config } from '../src/config.js';
import { CRM_AGENT_SYSTEMS } from '../src/crm/types.js';
import { createApp } from '../src/app.js';

test('crm password seal round-trips and never equals plaintext', () => {
  const password = 's3cret-CRM-login!';
  const sealed = sealCrmPassword(password);
  assert.notEqual(sealed.cipher, password);
  assert.ok(sealed.iv.length >= 16);
  assert.ok(sealed.tag.length >= 16);
  assert.equal(openCrmPassword(sealed), password);
});

test('crm key rotation: a previous key still opens old rows and marks them stale', () => {
  const password = 'rotate-me-CRM-login!';
  const original = config.crmCredentials.keyMaterial;
  const savedPrevious = process.env.CRM_CREDENTIAL_KEY_PREVIOUS;
  try {
    const sealed = sealCrmPassword(password);
    assert.deepEqual(openCrmPasswordDetailed(sealed), { password, stale: false });

    (config.crmCredentials as { keyMaterial: string }).keyMaterial = 'a-brand-new-crm-credential-key-for-tests-0001';
    delete process.env.CRM_CREDENTIAL_KEY_PREVIOUS;
    assert.throws(() => openCrmPassword(sealed), 'old rows do not open without the previous key');

    process.env.CRM_CREDENTIAL_KEY_PREVIOUS = `some-other-retired-key, ${original}`;
    assert.deepEqual(openCrmPasswordDetailed(sealed), { password, stale: true });
    const resealed = sealCrmPassword(password);
    assert.deepEqual(openCrmPasswordDetailed(resealed), { password, stale: false });
  } finally {
    (config.crmCredentials as { keyMaterial: string }).keyMaterial = original;
    if (savedPrevious === undefined) delete process.env.CRM_CREDENTIAL_KEY_PREVIOUS;
    else process.env.CRM_CREDENTIAL_KEY_PREVIOUS = savedPrevious;
  }
});

test('four CRM agent systems are defined', () => {
  assert.deepEqual([...CRM_AGENT_SYSTEMS], [
    'jobnimbus',
    'acculynx',
    'salesforce',
    'servicetitan',
  ]);
});

async function listen(): Promise<{ url: string; close: () => Promise<void> }> {
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

test('GET /api/crm-credentials is mounted (not 404)', async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/crm-credentials`, {
      headers: { accept: 'application/json' },
    });
    // Unauthenticated calls hit requireAuth. On Node <22 Supabase realtime may
    // 500 before a clean 401; either way the route must not be a removed-path 404.
    assert.notEqual(res.status, 404, 'crm-credentials must be mounted');
  } finally {
    await close();
  }
});

test('removed /api/crm-sync still 404s (legacy API-key path)', async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/crm-sync/status`, {
      headers: { accept: 'application/json' },
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});
