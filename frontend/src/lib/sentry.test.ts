import { describe, expect, it } from 'vitest';
import { parseSentryDsn, reportOfficeException } from './sentry';

describe('parseSentryDsn', () => {
  it('returns null when unset or malformed', () => {
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn('')).toBeNull();
    expect(parseSentryDsn('not-a-url')).toBeNull();
  });

  it('parses a standard Sentry DSN', () => {
    const parsed = parseSentryDsn('https://abc123@o1.ingest.sentry.io/450');
    expect(parsed).toMatchObject({
      publicKey: 'abc123',
      host: 'o1.ingest.sentry.io',
      projectId: '450',
      storeUrl: 'https://o1.ingest.sentry.io/api/450/store/',
    });
  });
});

describe('reportOfficeException', () => {
  it('is a no-op without a DSN', async () => {
    let called = false;
    const sent = await reportOfficeException(new Error('boom'), '', async () => {
      called = true;
      return new Response('ok');
    });
    expect(sent).toBe(false);
    expect(called).toBe(false);
  });

  it('POSTs to the store URL when a DSN is set', async () => {
    const urls: string[] = [];
    const sent = await reportOfficeException(
      new Error('boom'),
      'https://abc123@o1.ingest.sentry.io/450',
      async (url) => {
        urls.push(String(url));
        return new Response('{"id":"1"}', { status: 200 });
      },
    );
    expect(sent).toBe(true);
    expect(urls[0]).toBe('https://o1.ingest.sentry.io/api/450/store/');
  });
});
