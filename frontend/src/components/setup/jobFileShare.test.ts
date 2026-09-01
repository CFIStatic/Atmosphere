import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

describe('Dashboard job-file share', () => {
  it('is just an email field and Send invite — no label, expiry, or copy-link form', () => {
    expect(verifierHtml).toContain("return 'Share this job file'");
    expect(verifierHtml).toContain('data-jf-tab="share"');
    expect(verifierHtml).toMatch(/data-jf-tab="share"[\s\S]*?>Share file</);

    expect(verifierHtml).toContain('id="jf-share-form"');
    expect(verifierHtml).toContain(
      '<label><span>Email</span><input name="email" type="email" required autocomplete="email" placeholder="homeowner@example.com" /></label>',
    );
    expect(verifierHtml).toContain('>Send invite</button>');

    expect(verifierHtml).not.toContain('Who is this for?');
    expect(verifierHtml).not.toContain('Email them (optional)');
    expect(verifierHtml).not.toContain('Link expires');
    expect(verifierHtml).not.toContain('Create link');
    expect(verifierHtml).not.toContain('Send a read-only progress link');
    expect(verifierHtml).not.toContain('No progress links issued yet.');
    expect(verifierHtml).toContain('Nobody has been invited yet.');
  });

  it('emails the invite with the address as the label and no expiry picker', () => {
    const submitShare = verifierHtml.match(/function submitShare\(form\) \{[\s\S]*?\n  \}/);
    expect(submitShare).not.toBeNull();
    expect(submitShare![0]).toContain("Enter an email to send the invite.");
    expect(submitShare![0]).toContain('label: email');
    expect(submitShare![0]).toContain('recipientEmail: email');
    expect(submitShare![0]).toContain("kind: 'progress'");
    expect(submitShare![0]).not.toContain('expiresInDays');
    expect(submitShare![0]).not.toContain('form.label');
    expect(submitShare![0]).not.toContain('form.days');

    const shareList = verifierHtml.match(/function shareListHtml\(b\) \{[\s\S]*?\n  \}/);
    expect(shareList).not.toBeNull();
    expect(shareList![0]).toContain('Nobody has been invited yet.');
    expect(shareList![0]).not.toContain('Copy link');
    expect(shareList![0]).not.toContain('jf-copy');
  });
});
