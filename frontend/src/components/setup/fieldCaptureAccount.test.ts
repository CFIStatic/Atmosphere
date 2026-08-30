import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const fieldHtml = readFileSync(resolve(repoRoot, 'fieldcapture/index.html'), 'utf8');
const fieldApp = readFileSync(resolve(repoRoot, 'fieldcapture/js/app.js'), 'utf8');

function headerHtml() {
  const from = fieldHtml.indexOf('<div class="top">');
  const to = fieldHtml.indexOf('<!-- ================= HOME:', from);
  if (from < 0 || to < 0) throw new Error('Could not find Field Capture header');
  return fieldHtml.slice(from, to);
}

describe('Field Capture account menu', () => {
  it('puts Appearance inside the profile menu, not as a header pill', () => {
    const top = headerHtml();
    const chip = top.indexOf('id="who-btn"');
    const menu = top.indexOf('id="who-menu"');
    const toggle = top.indexOf('id="fc-theme-toggle"');
    const settings = top.indexOf('id="fc-menu-settings"');
    const signout = top.indexOf('id="fc-menu-signout"');
    expect(chip).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(chip);
    expect(toggle).toBeGreaterThan(menu);
    expect(settings).toBeGreaterThan(toggle);
    expect(signout).toBeGreaterThan(settings);
    expect(top).toContain('Appearance: Light');
    expect(top).toContain('class="who-menu-head"');
    expect(top).not.toContain('who-block');
    expect(top).not.toContain('id="who-line"');
    expect((top.match(/theme-toggle/g) || []).length).toBeGreaterThan(0);
    expect(top.indexOf('id="fc-theme-toggle"')).toBeGreaterThan(top.indexOf('role="menu"'));
  });

  it('paints the chip and opens Appearance from the account card', () => {
    const paintJs = fieldApp.match(
      /function initialsFrom\(name, email\) \{[\s\S]*?showFieldAccount\(true, \{ account: Boolean\(opts.account\) \}\);\n  \}/,
    );
    expect(paintJs).not.toBeNull();

    const dom = new JSDOM(
      `<!doctype html><html><body>${headerHtml()}<script>
        ${paintJs![0]}
        window.__fcAccount = { paintFieldAccount: paintFieldAccount, closeFieldAccountMenu: closeFieldAccountMenu };
      </script></body></html>`,
      { runScripts: 'dangerously', url: 'https://field-capture.test/' },
    );
    const { document } = dom.window;
    const api = (
      dom.window as unknown as {
        __fcAccount: {
          paintFieldAccount: (opts: {
            name: string;
            email?: string;
            org?: string;
            avatarUrl?: string | null;
            account?: boolean;
          }) => void;
          closeFieldAccountMenu: () => void;
        };
      }
    ).__fcAccount;

    api.paintFieldAccount({
      name: 'Jack Cyganiak',
      email: 'jack@jettx.ai',
      org: 'Jettx LLC',
      account: true,
    });

    expect(document.getElementById('who-wrap')?.hidden).toBe(false);
    expect(document.getElementById('who-name')?.textContent).toBe('Jack Cyganiak');
    expect(document.getElementById('who-sub')?.textContent).toBe('Jettx LLC');
    expect(document.getElementById('who-avatar')?.textContent).toBe('JC');
    expect(document.getElementById('who-avatar')?.querySelector('img')).toBeNull();
    expect(document.getElementById('menu-name')?.textContent).toBe('Jack Cyganiak');
    expect(document.getElementById('menu-email')?.textContent).toBe('jack@jettx.ai');
    expect(document.getElementById('menu-meta')?.textContent).toBe('Jettx LLC');
    expect(document.getElementById('fc-menu-settings')?.hidden).toBe(false);
    expect(document.getElementById('fc-menu-signout')?.hidden).toBe(false);
    expect(document.getElementById('fc-theme-toggle')?.closest('#who-menu')).not.toBeNull();

    const menu = document.getElementById('who-menu');
    expect(menu?.hidden).toBe(true);
    document.getElementById('who-btn')?.setAttribute('aria-expanded', 'true');
    if (menu) menu.hidden = false;
    expect(document.getElementById('fc-theme-toggle')?.textContent).toContain('Appearance:');
    api.closeFieldAccountMenu();
    expect(menu?.hidden).toBe(true);
  });

  it('paints the saved profile photo instead of initials', () => {
    const paintJs = fieldApp.match(
      /function initialsFrom\(name, email\) \{[\s\S]*?showFieldAccount\(true, \{ account: Boolean\(opts.account\) \}\);\n  \}/,
    );
    expect(paintJs).not.toBeNull();
    expect(fieldApp).toContain('opts.avatarUrl');
    expect(fieldApp).toContain('me.user.avatarUrl');

    const dom = new JSDOM(
      `<!doctype html><html><body>${headerHtml()}<script>
        ${paintJs![0]}
        window.__fcAccount = { paintFieldAccount: paintFieldAccount };
      </script></body></html>`,
      { runScripts: 'dangerously', url: 'https://field-capture.test/' },
    );
    const { document } = dom.window;
    const api = (
      dom.window as unknown as {
        __fcAccount: {
          paintFieldAccount: (opts: {
            name: string;
            email?: string;
            org?: string;
            avatarUrl?: string | null;
            account?: boolean;
          }) => void;
        };
      }
    ).__fcAccount;

    api.paintFieldAccount({
      name: 'Jack Cyganiak',
      email: 'jack@jettx.ai',
      org: 'Jettx LLC',
      avatarUrl: 'https://img.example/jack-icon.png',
      account: true,
    });

    const avatar = document.getElementById('who-avatar');
    expect(avatar?.textContent).toBe('');
    expect(avatar?.querySelector('img')?.getAttribute('src')).toBe('https://img.example/jack-icon.png');
  });

  it('opens Settings in the in-app Platform and signs out from the same menu', () => {
    expect(fieldApp).toContain("openPlatformInFrame('/settings')");
    expect(fieldApp).toContain('function signOutFieldAccount');
    expect(fieldApp).toContain("data.atmosphere === 'sign-out'");
    expect(fieldApp).toContain('paintFieldAccount');
    expect(fieldApp).not.toContain('showFieldThemeToggle');
  });
});
