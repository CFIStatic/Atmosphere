import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier dashboard theme toggle', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('puts light/dark under the account profile, not beside the chip', () => {
    const topbar = verifierHtml.match(/<header class="topbar">[\s\S]*?<\/header>/);
    expect(topbar).not.toBeNull();
    const chip = topbar![0].indexOf('id="who-btn"');
    const menu = topbar![0].indexOf('id="who-menu"');
    const toggle = topbar![0].indexOf('id="theme-toggle"');
    const settings = topbar![0].indexOf('id="menu-settings"');
    expect(chip).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(chip);
    expect(toggle).toBeGreaterThan(menu);
    expect(settings).toBeGreaterThan(toggle);
    expect(topbar![0]).toContain('class="theme-toggle-label"');
    expect(topbar![0]).toContain('Appearance: Light');
  });

  it('keeps the only light/dark button in the account menu, not above Settings in the rail', () => {
    const railFooter = verifierHtml.match(/<div class="rail-footer" id="rail-footer"[^>]*>[\s\S]*?<\/div>/);
    expect(railFooter).not.toBeNull();
    expect(railFooter![0]).toContain('id="nav-settings"');
    expect(railFooter![0]).not.toContain('theme-toggle');
    expect(verifierHtml).not.toContain('id="theme-toggle-rail"');
    expect((verifierHtml.match(/id="theme-toggle"/g) || []).length).toBe(1);
  });

  it('shows the destination icon for the current theme', () => {
    expect(verifierHtml).toContain(':root[data-theme="dark"] .theme-toggle .icon-sun { display: block; }');
    expect(verifierHtml).toContain(':root[data-theme="light"] .theme-toggle .icon-moon { display: block; }');
  });

  it('persists the same keys as the console and notifies an embedded parent', () => {
    expect(verifierHtml).toContain("localStorage.setItem(THEME_KEY, pref)");
    expect(verifierHtml).toContain("atmosphere: 'theme'");
    expect(verifierHtml).toContain("id=\"theme-toggle\"");
    expect(verifierHtml).toContain('Appearance: ');
  });

  it('toggles data-theme and atmosphere.theme on click', () => {
    const topbar = verifierHtml.match(/<header class="topbar">[\s\S]*?<\/header>/);
    const themeJs = verifierHtml.match(
      /var THEME_KEY = 'atmosphere\.theme';[\s\S]*?initThemeToggle\(\);/,
    );
    expect(topbar).not.toBeNull();
    expect(themeJs).not.toBeNull();

    const dom = new JSDOM(
      `<!doctype html><html><body>${topbar![0]}<script>
        var EMBEDDED = false;
        ${themeJs![0]}
      </script></body></html>`,
      { runScripts: 'dangerously', url: 'https://atmosphere.test/verifier/' },
    );

    const { document, localStorage: store } = dom.window;
    const toggle = document.getElementById('theme-toggle');
    expect(toggle).not.toBeNull();

    const initial = document.documentElement.getAttribute('data-theme');
    expect(initial === 'light' || initial === 'dark').toBe(true);

    toggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const next = document.documentElement.getAttribute('data-theme');
    expect(next).toBe(initial === 'dark' ? 'light' : 'dark');
    expect(store.getItem('atmosphere.theme')).toBe(next);
    expect(JSON.parse(store.getItem('atmosphere.preferences') || '{}').theme).toBe(next);
    expect(toggle!.getAttribute('aria-label')).toBe(`Switch to ${initial} mode`);
    expect(toggle!.querySelector('.theme-toggle-label')?.textContent).toBe(
      `Appearance: ${next === 'dark' ? 'Dark' : 'Light'}`,
    );
  });
});
