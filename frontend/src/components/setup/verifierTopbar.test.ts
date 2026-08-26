import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = verifierHtml.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing CSS for ${selector}`);
  return match[1];
}

describe('verifier dashboard top bar', () => {
  it('keeps the search bar opaque and mounted so the list cannot scroll through it', () => {
    const topbar = cssBlock('.topbar');
    expect(topbar).toContain('background: var(--panel)');
    expect(topbar).toContain('position: sticky');
    expect(topbar).toContain('top: 0');
    expect(topbar).toContain('z-index: 30');
    expect(topbar).toContain('backdrop-filter: none');
    expect(topbar).not.toMatch(/rgba?\([^)]+,\s*0?\.\d+/);
  });

  it('scrolls only the table, with the title bar outside that region', () => {
    expect(cssBlock('html, body')).toContain('overflow: hidden');
    expect(cssBlock('.app-frame')).toContain('overflow: hidden');
    expect(cssBlock('.main')).toContain('overflow-y: auto');
    expect(cssBlock('.toolbar')).not.toContain('position: sticky');

    const dash = verifierHtml.match(
      /<div class="screen screen-dashboard" id="screen-dashboard">([\s\S]*?)<div class="tablewrap">/,
    );
    expect(dash).not.toBeNull();
    expect(dash![1]).toMatch(/<div class="toolbar">[\s\S]*?<\/div>\s*<main class="main">/);
  });

  it('renders a large wordmark that fills the top-left corner', () => {
    const brand = cssBlock('.brand');
    expect(brand).toContain('font-size: 24px');
    expect(brand).toContain('gap: 14px');

    const mark = cssBlock('.brand svg');
    expect(mark).toContain('width: 40px');
    expect(mark).toContain('height: 40px');

    const railHead = cssBlock('.rail-head');
    expect(railHead).toContain('height: 72px');
    expect(cssBlock('.topbar')).toContain('height: 72px');

    const railBrand = verifierHtml.match(/id="brand-home"[\s\S]*?<\/button>/);
    expect(railBrand).not.toBeNull();
    expect(railBrand![0]).toContain('width="40"');
    expect(railBrand![0]).toContain('height="40"');
  });

  it('places the search bar outside the scrolling list', () => {
    const dash = verifierHtml.match(
      /<div class="app-frame"[\s\S]*?<header class="topbar">[\s\S]*?<\/header>[\s\S]*?<main class="main">/,
    );
    expect(dash).not.toBeNull();

    const dom = new JSDOM(verifierHtml);
    const topbar = dom.window.document.querySelector('header.topbar');
    const main = dom.window.document.querySelector('main.main');
    expect(topbar).not.toBeNull();
    expect(main).not.toBeNull();
    expect(main!.contains(topbar)).toBe(false);
    expect(topbar!.contains(main)).toBe(false);
  });
});
