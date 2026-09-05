import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captureException, parseSentryDsn, sentryEnabled } from './sentry.js';

describe('parseSentryDsn', () => {
  it('returns null when unset or malformed', () => {
    assert.equal(parseSentryDsn(undefined), null);
    assert.equal(parseSentryDsn(''), null);
    assert.equal(parseSentryDsn('not-a-url'), null);
    assert.equal(sentryEnabled({}), false);
  });

  it('parses a standard Sentry DSN', () => {
    const parsed = parseSentryDsn('https://abc123@o1.ingest.sentry.io/450');
    assert.ok(parsed);
    assert.equal(parsed.publicKey, 'abc123');
    assert.equal(parsed.host, 'o1.ingest.sentry.io');
    assert.equal(parsed.projectId, '450');
    assert.equal(parsed.storeUrl, 'https://o1.ingest.sentry.io/api/450/store/');
    assert.equal(sentryEnabled({ SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/450' }), true);
  });
});

describe('captureException', () => {
  it('is a no-op without a DSN', async () => {
    let called = false;
    const sent = await captureException(new Error('boom'), {}, {}, async () => {
      called = true;
      return new Response('ok');
    });
    assert.equal(sent, false);
    assert.equal(called, false);
  });

  it('POSTs to the store URL when a DSN is set', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const sent = await captureException(
      new Error('boom'),
      { path: '/api/health', requestId: 'req-1' },
      { SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/450' },
      async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(url), auth: headers.get('X-Sentry-Auth') });
        return new Response('{"id":"1"}', { status: 200 });
      },
    );
    assert.equal(sent, true);
    assert.equal(calls[0]?.url, 'https://o1.ingest.sentry.io/api/450/store/');
    assert.match(calls[0]?.auth ?? '', /sentry_key=abc123/);
  });
});
