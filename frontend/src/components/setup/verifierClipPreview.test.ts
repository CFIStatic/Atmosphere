import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function extractPreviewFns() {
  const escStart = verifierHtml.indexOf('function esc(s)');
  const helpersStart = verifierHtml.indexOf('function clipLength(s)');
  const helpersEnd = verifierHtml.indexOf('function clipRow(e)');
  if (escStart < 0 || helpersStart < 0 || helpersEnd <= helpersStart) {
    throw new Error('Could not find Dashboard clip-preview helpers in verifier/index.html');
  }
  const escEnd = verifierHtml.indexOf('\n  function ', escStart + 1);
  return new Function(
    `${verifierHtml.slice(escStart, escEnd)}
     function dur(s) {
       if (s == null) return '—';
       var m = Math.floor(s / 60), r = Math.round(s % 60);
       return m + ':' + String(r).padStart(2, '0');
     }
     ${verifierHtml.slice(helpersStart, helpersEnd)}
     return { clipLength, previewWindow, clipThumbHtml };`,
  )() as {
    clipLength: (s: unknown) => string;
    previewWindow: (durationSeconds: unknown) => { start: number; span: number };
    clipThumbHtml: (previewUrl: string | null, poster: string, lengthLabel: string) => string;
  };
}

describe('verifier dashboard clip preview', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('prints an em dash for a 0:00 header instead of claiming the clip is empty', () => {
    const { clipLength } = extractPreviewFns();
    expect(clipLength(null)).toBe('—');
    expect(clipLength(0)).toBe('—');
    expect(clipLength(96)).toBe('1:36');
  });

  it('skips the opening half-second and loops a short window', () => {
    const { previewWindow } = extractPreviewFns();
    expect(previewWindow(0)).toEqual({ start: 0.5, span: 4 });
    expect(previewWindow(96)).toEqual({ start: 0.5, span: 4 });
    expect(previewWindow(1.2)).toEqual({ start: 0, span: 1.2 });
  });

  it('puts the recorded file in a muted video thumb when a preview URL exists', () => {
    const { clipThumbHtml } = extractPreviewFns();
    const withFile = clipThumbHtml(
      'https://storage.example/sign/clip.webm?token=abc',
      'https://storage.example/sign/frame.jpg',
      '—',
    );
    expect(withFile).toContain('<video class="shot" muted playsinline preload="metadata"');
    expect(withFile).toContain('data-src="https://storage.example/sign/clip.webm?token=abc"');
    expect(withFile).toContain('poster="https://storage.example/sign/frame.jpg"');
    expect(withFile).toContain('data-preview="1"');
    expect(withFile).not.toContain('<img class="shot"');

    const stillOnly = clipThumbHtml(null, 'data:image/svg+xml;charset=utf-8,x', '1:36');
    expect(stillOnly).toContain('<img class="shot"');
    expect(stillOnly).not.toContain('<video');
    expect(stillOnly).toContain('1:36');

    const noDrawnPoster = clipThumbHtml(
      'https://storage.example/sign/clip.webm?token=abc',
      'data:image/svg+xml;charset=utf-8,x',
      '—',
    );
    expect(noDrawnPoster).toContain('<video');
    expect(noDrawnPoster).not.toContain('poster=');
  });

  it('wires live rows to the signed file URL and starts the snippet on screen', () => {
    expect(verifierHtml).toContain('previewUrl: raw.previewUrl || null');
    expect(verifierHtml).toContain('bindPreviewThumbs(rowsEl)');
    expect(verifierHtml).toContain('function startPreview(video)');
    expect(verifierHtml).toContain('.thumb video');
  });

  it('gives demo rows a local file so the preview cell can play without a backend', () => {
    expect(verifierHtml).toContain("/verifier/demo-preview.mp4");
    expect(verifierHtml).toContain('if (!o.previewUrl) o.previewUrl = \'/verifier/demo-preview.mp4\'');
  });

  it('renders a muted video thumb on each demo clip row', async () => {
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
    const videos = Array.from(dom.window.document.querySelectorAll('tr[data-id] video.shot'));
    expect(videos.length).toBeGreaterThan(0);
    for (const video of videos) {
      expect(video.getAttribute('muted')).not.toBeNull();
      expect(video.getAttribute('data-src')).toBe('/verifier/demo-preview.mp4');
      expect(video.closest('.thumb')?.getAttribute('data-preview')).toBe('1');
    }
    const overlay = videos[0]?.parentElement?.querySelector('.dur')?.textContent;
    expect(overlay).not.toBe('0:00');
    expect(overlay).toBeTruthy();

    const row = dom.window.document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const player = dom.window.document.querySelector('#d-frame video') as HTMLVideoElement | null;
    expect(player).not.toBeNull();
    expect(player!.getAttribute('src')).toBe('/verifier/demo-preview.mp4');
    dom.window.close();
  });
});
