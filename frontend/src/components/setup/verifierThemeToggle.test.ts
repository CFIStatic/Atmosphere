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

  it('puts a light/dark button in the dashboard top bar', () => {
    const topbar = verifierHtml.match(/<header class="topbar">[\s\S]*?<\/header>/);
    expect(topbar).not.toBeNull();
    expect(topbar![0]).toContain('id="theme-toggle"');
    expect(topbar![0]).toContain('class="icon-moon"');
    expect(topbar![0]).toContain('class="icon-sun"');
    expect(topbar![0]).toMatch(/aria-label="Switch to (dark|light) mode"/);
  });

  it('shows the destination icon for the current theme', () => {
    expect(verifierHtml).toContain(':root[data-theme="dark"] .theme-toggle .icon-sun { display: block; }');
    expect(verifierHtml).toContain(':root[data-theme="light"] .theme-toggle .icon-moon { display: block; }');
  });

  it('persists the same keys as the console and notifies an embedded parent', () => {
    expect(verifierHtml).toContain("localStorage.setItem(THEME_KEY, pref)");
    expect(verifierHtml).toContain("atmosphere: 'theme'");
    expect(verifierHtml).toContain("id=\"theme-toggle\"");
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
    expect(toggle!.getAttribute('aria-label')).toBe(
      `Switch to ${initial} mode`,
    );
  });
});
