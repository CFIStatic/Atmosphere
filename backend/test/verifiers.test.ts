import test from 'node:test';
import assert from 'node:assert/strict';
import { ZeroBounceVerifier } from '../src/prospecting/verifiers/zeroBounce.js';
import { NeverBounceVerifier } from '../src/prospecting/verifiers/neverBounce.js';

/**
 * These tests are about one thing: a verifier's vocabulary becoming our
 * verdict without anything being rounded up on the way.
 *
 * The dangerous direction is optimism. "Unknown" quietly becoming "exists"
 * bills a customer for an address nobody confirmed; a vendor outage becoming
 * "does not exist" deletes real people from their list. Both are silent, and
 * both are what these assertions exist to catch.
 */

/** Swap global fetch for one canned response, and always put it back. */
async function withFetch<T>(handler: (url: string) => unknown, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const body = handler(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test('ZeroBounce maps its statuses without rounding anything up', async () => {
  const zb = new ZeroBounceVerifier('test-key');

  const valid = await withFetch(() => ({ status: 'valid' }), () =>
    zb.check('marcia@acme.com', 'acme.com'),
  );
  assert.equal(valid.exists, true);
  assert.equal(valid.catchAll, false);

  const invalid = await withFetch(() => ({ status: 'invalid' }), () =>
    zb.check('nobody@acme.com', 'acme.com'),
  );
  assert.equal(invalid.exists, false);

  const catchAll = await withFetch(() => ({ status: 'catch-all' }), () =>
    zb.check('marcia@acme.com', 'acme.com'),
  );
  assert.equal(catchAll.catchAll, true);
  assert.equal(catchAll.exists, null, 'a catch-all domain can confirm nothing');

  const unknown = await withFetch(() => ({ status: 'unknown' }), () =>
    zb.check('marcia@acme.com', 'acme.com'),
  );
  assert.equal(unknown.exists, null, 'unknown must stay unknown, never become true');
});

test('ZeroBounce refuses addresses that exist but must never be mailed', async () => {
  const zb = new ZeroBounceVerifier('test-key');
  for (const status of ['spamtrap', 'abuse', 'do_not_mail', 'toxic']) {
    const result = await withFetch(() => ({ status }), () => zb.check('x@acme.com', 'acme.com'));
    assert.equal(result.exists, false, `${status} must not be sold`);
  }
});

test('an unreachable verifier has no opinion rather than a negative one', async () => {
  // The failure mode this guards: ZeroBounce has an outage, every check reads
  // as "invalid", and the product starts telling customers their real contacts
  // are dead addresses.
  const zb = new ZeroBounceVerifier('test-key');
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  try {
    const result = await zb.check('marcia@acme.com', 'acme.com');
    assert.equal(result.exists, null);
    assert.equal(result.catchAll, null);
  } finally {
    globalThis.fetch = real;
  }
});

test('NeverBounce maps its own vocabulary the same way', async () => {
  const nb = new NeverBounceVerifier('test-key');

  const valid = await withFetch(() => ({ status: 'success', result: 'valid' }), () =>
    nb.check('marcia@acme.com', 'acme.com'),
  );
  assert.equal(valid.exists, true);

  const invalid = await withFetch(() => ({ status: 'success', result: 'invalid' }), () =>
    nb.check('nobody@acme.com', 'acme.com'),
  );
  assert.equal(invalid.exists, false);

  const catchAll = await withFetch(() => ({ status: 'success', result: 'catchall' }), () =>
    nb.check('marcia@acme.com', 'acme.com'),
  );
  assert.equal(catchAll.catchAll, true);
  assert.equal(catchAll.exists, null);

  const disposable = await withFetch(() => ({ status: 'success', result: 'disposable' }), () =>
    nb.check('x@mailinator.com', 'mailinator.com'),
  );
  assert.equal(disposable.exists, false);
  assert.equal(disposable.disposable, true);
});

test('NeverBounce reporting failure in a 200 body is still a failure', async () => {
  // Their API returns HTTP 200 with status:'auth_failure' for a bad key. Read
  // only the HTTP status and a rejected key looks like a clean "unknown".
  const nb = new NeverBounceVerifier('bad-key');
  const result = await withFetch(
    () => ({ status: 'auth_failure', message: 'Invalid API key' }),
    () => nb.check('marcia@acme.com', 'acme.com'),
  );
  assert.equal(result.exists, null);
  assert.match(result.detail ?? '', /did not respond/);
});
