import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

describe('verifier YouTube progress line', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('uses YouTube’s published ytp-progress-bar values, not a restyled capsule', () => {
    expect(verifierHtml).toContain('--yt-progress: #f00');
    expect(verifierHtml).toContain('--yt-track: rgba(255, 255, 255, 0.2)');
    expect(verifierHtml).toContain('--yt-buffered: rgba(255, 255, 255, 0.4)');
    expect(verifierHtml).toContain('--yt-hover: rgba(255, 255, 255, 0.5)');
    expect(verifierHtml).toContain('--yt-rail-h: 3px');
    expect(verifierHtml).toContain('--yt-rail-h-hot: 5px');
    expect(verifierHtml).toContain('--yt-knob: 13px');
    expect(verifierHtml).toMatch(/\.vp \.vp-played \{[^}]*background: var\(--yt-progress\)/);
    expect(verifierHtml).toMatch(/\.vp \.vp-knob \{[\s\S]*?border-radius: 50%;[\s\S]*?background: var\(--yt-progress\)/);
    expect(verifierHtml).toContain('height: var(--yt-rail-h-hot)');
    expect(verifierHtml).not.toMatch(/<video\s+controls\b/);
  });

  it('mounts a custom player on a real clip instead of the browser chrome', () => {
    expect(verifierHtml).toContain('function mountPlayer');
    expect(verifierHtml).toContain('function unmountPlayer');
    expect(verifierHtml).toContain("class=\"vp-played\"");
    expect(verifierHtml).toContain("class=\"vp-knob\"");
    expect(verifierHtml).toContain("class=\"vp-buffered\"");
    expect(verifierHtml).toContain('mountPlayer(item, item._videoUrl)');
    expect(verifierHtml).toContain('.controls[hidden] { display: none; }');
    expect(verifierHtml).toContain('return clipLength(video, item)');
    expect(verifierHtml).toContain('function startPaintTick');
    expect(verifierHtml).toContain('.vp[data-idle="1"][data-paused="0"] .vp-row');
    expect(verifierHtml).not.toMatch(
      /\.vp\[data-idle="1"\]\[data-paused="0"\] \.vp-chrome \{ opacity: 0/,
    );
  });

  it('still opens a demo clip on the schematic path and writes analysis notes', async () => {
    const dom = new JSDOM(verifierHtml, {
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

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('detail')?.getAttribute('data-open')).toBe('1');
    expect(document.querySelector('.vp')).toBeNull();
    expect(document.querySelector('#d-frame img')).not.toBeNull();
    expect(document.querySelector('.player .controls')?.hasAttribute('hidden')).toBe(false);

    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const notes = Array.from(document.querySelectorAll('#alog li:not(.soon) [data-full]'));
    expect(notes.length).toBeGreaterThan(0);
    dom.window.close();
  });
});
