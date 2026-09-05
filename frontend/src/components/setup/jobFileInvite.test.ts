import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

describe('Dashboard job-file add people', () => {
  it('confirms the emailed invite without showing the Field Capture URL', () => {
    const paintInvite = verifierHtml.match(
      /if \(jobSheet\.tab === 'invite'\) \{[\s\S]*?return;\n    \}/,
    );
    expect(paintInvite).not.toBeNull();
    expect(paintInvite![0]).toContain("class=\"jf-made\"");
    expect(paintInvite![0]).toContain('esc(jobSheet.made.note)');
    expect(paintInvite![0]).not.toContain('jobSheet.made.path');
    expect(paintInvite![0]).not.toContain('<code>');
    expect(paintInvite![0]).not.toContain('fieldCapturePath');

    expect(verifierHtml).not.toContain('.jf-made code');
    expect(verifierHtml).not.toContain('Copy the Field Capture link below');
  });

  it('does not attach a capture link to the invite success state', () => {
    const submitInvite = verifierHtml.match(/function submitInvite\(form\) \{[\s\S]*?\n  \}/);
    expect(submitInvite).not.toBeNull();
    expect(submitInvite![0]).toContain('Invite emailed to ');
    expect(submitInvite![0]).toContain('The same link opens on the web office and Field Capture.');
    expect(submitInvite![0]).not.toContain('path:');
    expect(submitInvite![0]).not.toContain('fieldCapturePath');
    expect(submitInvite![0]).not.toContain('sharePath');
    expect(submitInvite![0]).toContain('Atmosphere could not send the email. Try again.');
  });
});
