import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The composition the proof pipeline actually performs: read the org's key out
 * of the vault, put it in scope, run the work. Tested against the real
 * encrypted store rather than a stub, because the bug being fixed was that
 * these two halves had never been joined up.
 */

const dir = await mkdtemp(join(tmpdir(), 'atm-cred-'));
delete process.env.ANTHROPIC_API_KEY;
process.env.AI_CREDENTIALS_KEY = 'test-credentials-key-for-the-vault-round-trip';
process.env.AI_CREDENTIALS_PATH = join(dir, 'ai-credentials.json');

const { getApiKey, setApiKey, clearApiKey } = await import('../src/computer/credentials.js');
const { isModelProviderConfigured, withOrgApiKey } = await import('../src/lib/anthropic.js');

test.after(() => rm(dir, { recursive: true, force: true }));

test('a key connected in the UI is what the clip pipeline runs on', async () => {
  // Nothing connected, no server key: the pipeline correctly declines.
  assert.equal(await getApiKey('org-1'), null);
  assert.equal(
    withOrgApiKey(await getApiKey('org-1'), () => isModelProviderConfigured()),
    false,
  );

  await setApiKey('org-1', 'sk-ant-api03-connected-in-the-ui', 'user-1');

  // The same two lines performAnalysis and performNarration now run.
  const key = await getApiKey('org-1');
  assert.equal(key, 'sk-ant-api03-connected-in-the-ui');
  assert.equal(
    withOrgApiKey(key, () => isModelProviderConfigured()),
    true,
  );
});

test('one org key never answers for another org', async () => {
  await setApiKey('org-1', 'sk-ant-api03-connected-in-the-ui', 'user-1');
  assert.equal(await getApiKey('org-2'), null);
  assert.equal(
    withOrgApiKey(await getApiKey('org-2'), () => isModelProviderConfigured()),
    false,
  );
});

test('disconnecting a key puts the pipeline back to unconfigured', async () => {
  await setApiKey('org-1', 'sk-ant-api03-connected-in-the-ui', 'user-1');
  await clearApiKey('org-1');
  assert.equal(await getApiKey('org-1'), null);
  assert.equal(
    withOrgApiKey(await getApiKey('org-1'), () => isModelProviderConfigured()),
    false,
  );
});
