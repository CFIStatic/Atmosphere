import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZodError } from 'zod';
import { HttpError } from './errors.js';
import { shouldReportError } from '../middleware/errorHandler.js';
import { captureException, initSentry, parseSentryDsn, scrubEvent, sentryEnabled } from './sentry.js';

test('sentry is off without a DSN', () => {
  assert.equal(sentryEnabled({}), false);
  assert.equal(initSentry({}), false);
  assert.equal(captureException(new Error('x')), false);
  assert.equal(parseSentryDsn('not a url'), null);
  assert.deepEqual(parseSentryDsn('https://abc@o1.ingest.example.com/42'), {
    publicKey: 'abc',
    host: 'o1.ingest.example.com',
    projectId: '42',
  });
});

test('scrubEvent strips auth headers, cookies, query strings and tokens', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';
  const event = scrubEvent<{
    request?: Record<string, unknown>;
    user?: unknown;
    extra?: unknown;
    message?: string;
    exception?: { values?: Array<{ value?: string }> };
  }>({
    request: {
      url: 'https://api.example.com/api/x?token=abc',
      query_string: 'token=abc',
      cookies: { sb: 'secret' },
      data: { password: 'p' },
      headers: { authorization: 'Bearer abc', cookie: 'a=b', 'user-agent': 'ua', 'x-refresh-token': 'r' },
    },
    user: { email: 'crew@example.com' },
    extra: { nested: { access_token: 't', note: `auth ${jwt}` } },
    message: 'failed with Bearer abc.def',
    exception: { values: [{ value: `bad ${jwt}` }] },
  });
  assert.equal(event.request?.url, 'https://api.example.com/api/x');
  assert.equal(event.request?.query_string, undefined);
  assert.equal(event.request?.cookies, undefined);
  assert.equal(event.request?.data, undefined);
  assert.deepEqual(event.request?.headers, {
    authorization: '[Filtered]',
    cookie: '[Filtered]',
    'user-agent': 'ua',
    'x-refresh-token': '[Filtered]',
  });
  assert.equal(event.user, undefined);
  assert.deepEqual(event.extra, { nested: { access_token: '[Filtered]', note: 'auth [Filtered]' } });
  assert.equal(event.message, 'failed with Bearer [Filtered]');
  assert.equal(event.exception?.values?.[0]?.value, 'bad [Filtered]');
});

test('only unexpected (500) errors are reported', () => {
  assert.equal(shouldReportError(new Error('boom')), true);
  assert.equal(shouldReportError(new ZodError([])), false);
  assert.equal(shouldReportError(Object.assign(new Error('big'), { type: 'entity.too.large' })), false);
  const e404 = Object.create(HttpError.prototype) as HttpError;
  Object.assign(e404, { status: 404 });
  assert.equal(shouldReportError(e404), false);
});
