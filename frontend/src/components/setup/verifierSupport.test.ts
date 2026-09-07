import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const verifierFrame = readFileSync(resolve(here, '../VerifierFrame.tsx'), 'utf8');

describe('verifier Platform Support', () => {
  it('puts Support in the account menu next to Settings', () => {
    const menu = verifierHtml.match(/<div class="who-menu" id="who-menu"[\s\S]*?<\/div>\s*<\/div>\s*<\/header>/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain('id="menu-settings"');
    expect(menu![0]).toContain('id="menu-support"');
    expect(menu![0]).toContain('data-i18n-chrome="support"');
    expect(menu![0].indexOf('id="menu-support"')).toBeGreaterThan(menu![0].indexOf('id="menu-settings"'));
    expect(menu![0].indexOf('id="menu-signout"')).toBeGreaterThan(menu![0].indexOf('id="menu-support"'));
  });

  it('asks the office shell to open the shared contact form', () => {
    expect(verifierHtml).toContain("atmosphere: 'open-support'");
    expect(verifierHtml).toContain('https://atmosphereteam.com/contact.html?note=');
    expect(verifierHtml).toContain("I need help with Atmosphere Platform.");
    expect(verifierFrame).toContain("data.atmosphere === 'open-support'");
    expect(verifierFrame).toContain('openPlatformSupport');
  });
});
