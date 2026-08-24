import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function bootVerifier(html = verifierHtml) {
  return new JSDOM(html, {
    url: 'https://atmosphere.test/verifier/?demo=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      })) as unknown as typeof window.matchMedia;
    },
  });
}

describe('verifier dashboard video preview screen', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('keeps the preview as a dashboard screen next to the list, not a modal overlay', () => {
    const shell = verifierHtml.match(/<div class="shell" id="shell">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(shell).not.toBeNull();
    expect(shell![0]).toContain('id="screen-dashboard"');
    expect(shell![0]).toContain('id="detail"');
    expect(shell![0]).toContain('class="screen screen-preview"');
    expect(shell![0]).toContain('id="d-back"');
    expect(shell![0]).toMatch(/id="d-back"[\s\S]*Dashboard[\s\S]*<\/button>/);
    expect(verifierHtml).not.toMatch(/id="detail"[^>]*role="dialog"/);
  });

  it('paints the still on file before waiting on the signed video URL', () => {
    expect(verifierHtml).toContain('function paintPreviewShell');
    expect(verifierHtml).toContain('Opening the clip on file');
    expect(verifierHtml).toContain('class="preview-still"');
    const paint = verifierHtml.indexOf('paintPreviewShell(item, tab)');
    const fetchDetail = verifierHtml.indexOf('fetchRemoteDetail(item)');
    expect(paint).toBeGreaterThan(0);
    expect(fetchDetail).toBeGreaterThan(paint);
  });

  it('opens a clip onto the preview screen and back returns to the dashboard list', async () => {
    const dom = bootVerifier();
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const dashboard = document.getElementById('screen-dashboard');
    const preview = document.getElementById('detail');
    expect(dashboard?.hidden).toBe(false);
    expect(preview?.getAttribute('data-open')).not.toBe('1');

    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(preview?.getAttribute('data-open')).toBe('1');
    expect(preview?.hidden).toBe(false);
    expect(dashboard?.hidden).toBe(true);
    expect(document.querySelector('#d-frame img, #d-frame video')).not.toBeNull();
    expect(document.getElementById('d-title')?.textContent).not.toBe('—');

    document.getElementById('d-back')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(preview?.getAttribute('data-open')).toBe('0');
    expect(preview?.hidden).toBe(true);
    expect(dashboard?.hidden).toBe(false);
    expect(document.querySelector('tr[data-id="EV-1038-0805-A"]')).not.toBeNull();
    dom.window.close();
  });
});
