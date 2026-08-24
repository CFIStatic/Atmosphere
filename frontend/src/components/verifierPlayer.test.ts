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
    expect(verifierHtml).toContain('function playVideo');
    expect(verifierHtml).toContain('class="vp-err"');
    expect(verifierHtml).toContain('.vp[data-idle="1"][data-paused="0"] .vp-row');
    expect(verifierHtml).not.toMatch(
      /\.vp\[data-idle="1"\]\[data-paused="0"\] \.vp-chrome \{ opacity: 0/,
    );
    expect(verifierHtml).not.toMatch(/<video[^>]*\bcrossorigin\b/);
    expect(verifierHtml).toMatch(/\.vp \{[\s\S]*?position: absolute; inset: 0/);
    expect(verifierHtml).toContain('item._videoUrl = playtest');
  });

  it('progresses the red line against the real clip length, not a 2s buffer window', () => {
    const match = verifierHtml.match(/function clipLength\(vid, item\) \{[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();
    const clipLength = new Function(`${match![0]}; return clipLength;`)() as (
      vid: { duration?: number; currentTime?: number; seekable?: { length: number; end: (i: number) => number } },
      item: { duration?: number } | null,
    ) => number;

    const twoSecondWindow = {
      duration: Number.POSITIVE_INFINITY,
      currentTime: 3,
      seekable: { length: 1, end: () => 2 },
    };
    expect(clipLength(twoSecondWindow, { duration: 11 })).toBe(11);
    expect(3 / clipLength(twoSecondWindow, { duration: 11 })).toBeCloseTo(3 / 11);

    expect(clipLength({ duration: 11, currentTime: 3, seekable: { length: 1, end: () => 2 } }, { duration: 2 })).toBe(11);

    expect(clipLength({ duration: Number.NaN, currentTime: 0, seekable: { length: 1, end: () => 2 } }, { duration: 0 })).toBe(0);
    expect(clipLength({ duration: Number.POSITIVE_INFINITY, currentTime: 5, seekable: { length: 0, end: () => 0 } }, { duration: 2 })).toBe(0);
    expect(verifierHtml).not.toContain('Math.max(t + 2, 1)');
    expect(verifierHtml).toContain('function adoptMediaDuration');
  });

  it('mounts a real clip from playtest without asking the file for CORS', async () => {
    const dom = new JSDOM(verifierHtml, {
      url: 'https://atmosphere.test/verifier/?demo=1&playtest=https://cdn.example/clip.mp4',
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

    const video = document.querySelector('#d-frame video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('https://cdn.example/clip.mp4');
    expect(video!.getAttribute('crossorigin')).toBeNull();
    expect(document.querySelector('.vp-played')).not.toBeNull();
    expect(document.querySelector('.player .controls')?.hasAttribute('hidden')).toBe(true);
    dom.window.close();
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
