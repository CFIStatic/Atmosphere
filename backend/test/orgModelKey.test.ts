import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Whose account pays for a model call, and — the bug this pins — whether one
 * gets made at all.
 *
 * An organisation can connect its own Anthropic key in the UI. Until now only
 * computer use read that key: every other model call went straight to
 * ANTHROPIC_API_KEY and reported "Model access is not configured on this
 * server" when the env var was unset, however many keys the org had
 * connected. That is a clip left unread on a server perfectly able to read it.
 */

// The module reads config at import, and config reads the environment at its
// own import. Establish "no server-wide key" before either is pulled in.
delete process.env.ANTHROPIC_API_KEY;

const { anthropicClient, isModelProviderConfigured, withOrgApiKey } = await import(
  '../src/lib/anthropic.js'
);

test('with no key anywhere, the model is reported unconfigured', () => {
  assert.equal(isModelProviderConfigured(), false);
  assert.throws(() => anthropicClient(), /not configured/i);
});

test("an organisation's connected key makes the model available", () => {
  withOrgApiKey('sk-ant-api03-org-key', () => {
    assert.equal(isModelProviderConfigured(), true);
    assert.ok(anthropicClient());
  });
  // And it does not leak past the work it was scoped to.
  assert.equal(isModelProviderConfigured(), false);
});

test('a null key is not an error — it falls through to the server-wide key', () => {
  assert.equal(
    withOrgApiKey(null, () => isModelProviderConfigured()),
    false,
  );
  assert.equal(
    withOrgApiKey('   ', () => isModelProviderConfigured()),
    false,
  );
});

test('the scope survives an await, so a queued job keeps its own key', async () => {
  await withOrgApiKey('sk-ant-api03-org-key', async () => {
    await new Promise((r) => setTimeout(r, 1));
    // AsyncLocalStorage is the whole reason this holds across the await: a
    // module-level variable would be clobbered by the next concurrent job.
    assert.equal(isModelProviderConfigured(), true);
  });
});

test('two organisations run concurrently without borrowing each other keys', async () => {
  const seen: string[] = [];
  const run = (key: string, delay: number) =>
    withOrgApiKey(key, async () => {
      await new Promise((r) => setTimeout(r, delay));
      seen.push(`${key}:${isModelProviderConfigured()}`);
      return anthropicClient();
    });

  const [a, b] = await Promise.all([run('sk-ant-api03-org-a', 5), run('sk-ant-api03-org-b', 1)]);
  assert.deepEqual(seen.sort(), ['sk-ant-api03-org-a:true', 'sk-ant-api03-org-b:true']);
  // Different keys mean different clients — never one org's spend on another.
  assert.notEqual(a, b);
});

test('the same key reuses its client rather than opening a pool per call', () => {
  const first = withOrgApiKey('sk-ant-api03-org-a', () => anthropicClient());
  const second = withOrgApiKey('sk-ant-api03-org-a', () => anthropicClient());
  assert.equal(first, second);
});
