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

  it('uses a compact 16:9 screenshot in the Preview column', () => {
    expect(verifierHtml).toContain('width: 112px; height: 63px');
    expect(verifierHtml).toContain('function capturedStill');
    expect(verifierHtml).toContain('function captureVideoScreenshot');
    expect(verifierHtml).toMatch(/th style="width:128px"[^>]*data-sort-key="preview"/);
  });

  it('opens the clip as a liquid-glass overlay over the dashboard', () => {
    expect(verifierHtml).toContain('id="screen-dashboard"');
    expect(verifierHtml).toMatch(/id="detail"[^>]*role="dialog"/);
    expect(verifierHtml).toContain('class="screen screen-preview"');
    expect(verifierHtml).toContain('class="liquid-glass"');
    expect(verifierHtml).toContain('class="preview-pane"');
    expect(verifierHtml).toContain('class="preview-pane-fill"');
    expect(verifierHtml).toContain('border: 2px solid rgb(var(--glass-edge) / 0.55)');
    expect(verifierHtml).toMatch(/id="d-back"[\s\S]*Dashboard[\s\S]*<\/button>/);
    expect(verifierHtml).toContain('class="side"');
    expect(verifierHtml).toContain('backdrop-filter: blur(8px) saturate(140%)');
    expect(verifierHtml).toContain('animation: liquid-sheen');
    expect(verifierHtml).toContain("document.body.setAttribute('data-preview-open', '1')");
    expect(verifierHtml).not.toMatch(/if \(dash\) dash\.hidden = true;/);

    const structure = new JSDOM(verifierHtml).window.document;
    const frame = structure.getElementById('app-frame');
    const preview = structure.getElementById('detail');
    expect(frame).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(frame!.contains(preview)).toBe(false);
    expect(preview!.querySelector('.liquid-glass')).not.toBeNull();
    expect(preview!.querySelector('.preview-pane')).not.toBeNull();
    expect(preview!.querySelector('.preview-pane-fill')).not.toBeNull();
    expect(preview!.querySelector('.side')).not.toBeNull();
  });

  it('paints a YouTube-style screenshot from the clip before waiting on the file', () => {
    expect(verifierHtml).toContain('function paintPreviewPoster');
    expect(verifierHtml).toContain('function captureVideoScreenshot');
    expect(verifierHtml).toContain('class="preview-still"');
    expect(verifierHtml).toContain('class="yt-play"');
    expect(verifierHtml).toContain('Screenshot from this video');
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
    expect(dashboard?.hidden).toBe(false);
    expect(document.body.getAttribute('data-preview-open')).toBe('1');
    expect(document.querySelector('#detail .liquid-glass')).not.toBeNull();
    expect(document.querySelector('#detail .preview-pane')).not.toBeNull();
    expect(document.querySelector('#detail .preview-pane-fill')).not.toBeNull();
    expect(document.querySelector('#detail .side')).not.toBeNull();
    expect(document.querySelector('#d-frame img.preview-still')).not.toBeNull();
    expect(document.getElementById('d-yt-play')).not.toBeNull();
    expect(document.querySelector('#d-frame .yt-dur')).not.toBeNull();
    expect(document.getElementById('d-title')?.textContent).not.toBe('—');

    document.getElementById('d-back')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(preview?.getAttribute('data-open')).toBe('0');
    expect(preview?.hidden).toBe(true);
    expect(dashboard?.hidden).toBe(false);
    expect(document.body.getAttribute('data-preview-open')).toBeNull();
    expect(document.querySelector('tr[data-id="EV-1038-0805-A"]')).not.toBeNull();
    dom.window.close();
  });

  it('closes the overlay when the liquid-glass background is clicked', async () => {
    const dom = bootVerifier();
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const glass = document.querySelector('#detail .liquid-glass') as HTMLElement | null;
    expect(glass).not.toBeNull();
    glass!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('detail')?.getAttribute('data-open')).toBe('0');
    expect(document.getElementById('screen-dashboard')?.hidden).toBe(false);
    expect(document.body.getAttribute('data-preview-open')).toBeNull();
    dom.window.close();
  });
});
