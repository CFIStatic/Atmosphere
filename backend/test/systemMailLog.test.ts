import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * File-mail sink for Approve & invite when SMTP/Resend are unset.
 * Runs with cwd switched into a temp dir so .mail/ never lands in the repo.
 */

describe('systemMail log sink', () => {
  let cwd = '';
  let tmp = '';

  before(async () => {
    cwd = process.cwd();
    tmp = await mkdtemp(path.join(os.tmpdir(), 'atm-mail-'));
    process.chdir(tmp);
    process.env.SYSTEM_MAIL_DRIVER = 'log';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.CAREERS_FROM_EMAIL;
  });

  after(async () => {
    process.chdir(cwd);
    delete process.env.SYSTEM_MAIL_DRIVER;
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes invite mail to .mail and reports ok', async () => {
    // Fresh import after env is set for this process.
    const { sendSystemMail, systemMailConfigured, logMailEnabled } = await import(
      '../src/lib/systemMail.js'
    );
    assert.equal(logMailEnabled(), true);
    assert.equal(systemMailConfigured(), true);

    const result = await sendSystemMail({
      to: 'crew@example.com',
      subject: 'Capture invite — Meridian Ave',
      text: 'Open your capture link to film the day.',
      html: '<p>Open your capture link to film the day.</p>',
    });
    assert.equal(result.ok, true);

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(path.join(tmp, '.mail'));
    assert.ok(files.some((f) => f.endsWith('.txt')));
    assert.ok(files.some((f) => f.endsWith('.html')));
    const txt = files.find((f) => f.endsWith('.txt'))!;
    const body = await readFile(path.join(tmp, '.mail', txt), 'utf8');
    assert.match(body, /crew@example\.com/);
    assert.match(body, /Capture invite/);
  });
});

describe('systemMail Resend', () => {
  const originalFetch = globalThis.fetch;
  let calls: { url: string; body: unknown }[] = [];

  before(() => {
    process.env.SYSTEM_MAIL_DRIVER = 'resend';
    process.env.RESEND_API_KEY = 're_test_invite';
    process.env.CAREERS_FROM_EMAIL = 'jack@jettx.ai';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SYSTEM_MAIL_DRIVER;
    delete process.env.RESEND_API_KEY;
    const { resetResendDomainCache } = await import('../src/lib/resendFrom.js');
    resetResendDomainCache();
  });

  function mockFetch(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  ) {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown = null;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = String(init.body);
        }
      }
      calls.push({ url, body });
      return handler(url, init);
    }) as typeof fetch;
  }

  it('sends as hello@invites.jettx.ai when no listed domain is verified', async () => {
    const { resetResendDomainCache } = await import('../src/lib/resendFrom.js');
    resetResendDomainCache();
    mockFetch(async (url) => {
      if (url.includes('/domains')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    });

    const { sendSystemMail } = await import('../src/lib/systemMail.js');
    const result = await sendSystemMail({
      to: 'crew@example.com',
      subject: 'Capture invite',
      text: 'Open the link',
    });
    assert.equal(result.ok, true);
    const send = calls.find((c) => c.url.includes('/emails'));
    assert.ok(send);
    assert.match(String((send!.body as { from: string }).from), /hello@invites\.jettx\.ai/);
  });

  it('sends as jack@jettx.ai when that domain is verified', async () => {
    const { resetResendDomainCache } = await import('../src/lib/resendFrom.js');
    resetResendDomainCache();
    mockFetch(async (url) => {
      if (url.includes('/domains')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'd1', name: 'jettx.ai', status: 'verified' }] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: 'msg_2' }), { status: 200 });
    });

    const { sendSystemMail } = await import('../src/lib/systemMail.js');
    const result = await sendSystemMail({
      to: 'tech@roitechai.com',
      subject: 'Capture invite',
      text: 'Open the link',
    });
    assert.equal(result.ok, true);
    const send = calls.find((c) => c.url.includes('/emails'));
    assert.ok(send);
    assert.match(String((send!.body as { from: string }).from), /jack@jettx\.ai/);
  });

  it('retries hello@invites.jettx.ai when jack@jettx.ai is rejected', async () => {
    const { resetResendDomainCache } = await import('../src/lib/resendFrom.js');
    resetResendDomainCache();
    let emailPosts = 0;
    mockFetch(async (url) => {
      if (url.includes('/domains')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'd1', name: 'jettx.ai', status: 'verified' }] }),
          { status: 200 },
        );
      }
      emailPosts += 1;
      if (emailPosts === 1) {
        return new Response(
          JSON.stringify({
            statusCode: 403,
            message: 'The jettx.ai domain is not verified. Please verify a domain',
          }),
          { status: 403 },
        );
      }
      return new Response(JSON.stringify({ id: 'msg_3' }), { status: 200 });
    });

    const { sendSystemMail } = await import('../src/lib/systemMail.js');
    const result = await sendSystemMail({
      to: 'jack@jettx.ai',
      subject: 'Capture invite',
      text: 'Open the link',
    });
    assert.equal(result.ok, true);
    const emailCalls = calls.filter((c) => c.url.includes('/emails'));
    assert.equal(emailCalls.length, 2);
    assert.match(String((emailCalls[0]!.body as { from: string }).from), /jack@jettx\.ai/);
    assert.match(String((emailCalls[1]!.body as { from: string }).from), /hello@invites\.jettx\.ai/);
  });

  it('send-only API key sends as hello@invites.jettx.ai', async () => {
    const { resetResendDomainCache } = await import('../src/lib/resendFrom.js');
    resetResendDomainCache();
    mockFetch(async (url) => {
      if (url.includes('/domains')) {
        return new Response(
          JSON.stringify({
            statusCode: 401,
            message: 'This API key is restricted to only send emails',
            name: 'restricted_api_key',
          }),
          { status: 401 },
        );
      }
      return new Response(JSON.stringify({ id: 'msg_4' }), { status: 200 });
    });

    const { sendSystemMail } = await import('../src/lib/systemMail.js');
    const result = await sendSystemMail({
      to: 'tech@roitechai.com',
      subject: 'Capture invite',
      text: 'Open the link',
    });
    assert.equal(result.ok, true);
    const emailCalls = calls.filter((c) => c.url.includes('/emails'));
    assert.equal(emailCalls.length, 1);
    assert.match(String((emailCalls[0]!.body as { from: string }).from), /hello@invites\.jettx\.ai/);
  });
});
