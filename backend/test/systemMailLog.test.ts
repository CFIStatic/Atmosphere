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
