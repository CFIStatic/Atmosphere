/**
 * Per-org egress: parsing COMPUTER_EGRESS and mapping to a Browserbase proxy.
 * Off by default; external office proxy or a pinned provider pool.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { browserbaseProxy, egressConfig, orgEgress } from '../src/computer/egress.js';

afterEach(() => {
  delete process.env.COMPUTER_EGRESS;
});

test('off by default', () => {
  delete process.env.COMPUTER_EGRESS;
  assert.equal(egressConfig().size, 0);
  assert.equal(orgEgress('org'), null);
  assert.equal(browserbaseProxy(null), null);
});

test('external proxy: credentials are split out of the server URL', () => {
  process.env.COMPUTER_EGRESS = JSON.stringify({ org: { proxyUrl: 'http://user%40co:p%3Aw@office.example.com:3128' } });
  const e = orgEgress('org');
  assert.deepEqual(e, { kind: 'external', server: 'http://office.example.com:3128', username: 'user@co', password: 'p:w' });
  assert.deepEqual(browserbaseProxy(e), { type: 'external', server: 'http://office.example.com:3128', username: 'user@co', password: 'p:w' });
});

test('geolocation egress pins country and optional city/state', () => {
  process.env.COMPUTER_EGRESS = JSON.stringify({ org: { geolocation: { country: 'us', city: 'Dallas' } } });
  assert.deepEqual(browserbaseProxy(orgEgress('org')), { type: 'browserbase', geolocation: { country: 'US', city: 'Dallas' } });
});

test('bad entries are skipped (invalid URL, missing country, junk)', () => {
  process.env.COMPUTER_EGRESS = JSON.stringify({
    a: { proxyUrl: 'not a url' },
    b: { geolocation: { city: 'Nowhere' } },
    c: { nonsense: true },
    d: { proxyUrl: 'ftp://x.example.com' },
  });
  assert.equal(egressConfig().size, 0);
});

test('malformed JSON yields no egress', () => {
  process.env.COMPUTER_EGRESS = '{not json';
  assert.equal(egressConfig().size, 0);
});
