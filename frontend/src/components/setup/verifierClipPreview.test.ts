import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    clipThumbHtml: (
      previewUrl: string | null,
      poster: string,
      lengthLabel: string,
      previewId?: string | null,
    ) => string;
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

  it('puts a real cut in the thumb, never a demo file or a drawn poster', () => {
    const { clipThumbHtml } = extractPreviewFns();
    const withFile = clipThumbHtml(
      'https://storage.example/sign/2026-08-22-after-preview.mp4?token=abc',
      'https://storage.example/sign/frame.jpg',
      '—',
    );
    expect(withFile).toContain('<video class="shot" muted playsinline preload="metadata"');
    expect(withFile).toContain(
      'data-src="https://storage.example/sign/2026-08-22-after-preview.mp4?token=abc"',
    );
    expect(withFile).toContain('poster="https://storage.example/sign/frame.jpg"');
    expect(withFile).toContain('data-preview="1"');
    expect(withFile).not.toContain('demo-preview');

    const stillOnly = clipThumbHtml(null, 'data:image/svg+xml;charset=utf-8,x', '1:36');
    expect(stillOnly).toContain('<img class="shot"');
    expect(stillOnly).not.toContain('<video');

    const fromApi = clipThumbHtml(null, 'data:image/svg+xml;charset=utf-8,x', '—', 'proof-1');
    expect(fromApi).toContain('data-preview-id="proof-1"');
    expect(fromApi).toContain('Opening the recorded clip…');
    expect(fromApi).not.toContain('poster=');
    expect(fromApi).not.toContain('demo-preview');
  });

  it('asks the portal to cut the recorded file when the list has no signed clip yet', () => {
    expect(verifierHtml).toContain("e._remote && !e.previewUrl ? e.id : null");
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/preview');
    expect(verifierHtml).toContain('function resolvePreviewSrc');
    expect(verifierHtml).toContain('function clipToOpen');
    expect(verifierHtml).toContain('function showOpeningSheet');
    expect(verifierHtml).not.toContain('/verifier/demo-preview.mp4');
    expect(verifierHtml).not.toContain("o.previewUrl = '/verifier/demo-preview.mp4'");
  });

  it('opens the newest live recording so the footage is on screen', () => {
    const start = verifierHtml.indexOf('function clipInstant(e, keys)');
    const end = verifierHtml.indexOf('function isActiveRecording(e)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const { clipToOpen } = new Function(
      `${verifierHtml.slice(start, end)}; return { clipToOpen };`,
    )() as {
      clipToOpen: (
        items: Array<{ id: string; uploadedAt?: string }>,
        search: string,
        live: boolean,
      ) => { id: string } | null;
    };
    const items = [
      { id: 'older', uploadedAt: '2026-08-21T12:00:00Z' },
      { id: 'jack-after', uploadedAt: '2026-08-22T18:25:00Z' },
    ];
    expect(clipToOpen(items, '', true)?.id).toBe('jack-after');
    expect(clipToOpen(items, '?open=older', true)?.id).toBe('older');
    expect(clipToOpen(items, '?open=none', true)).toBeNull();
    expect(clipToOpen(items, '', false)).toBeNull();
    expect(clipToOpen(items, '?open=latest', false)?.id).toBe('jack-after');
  });

  it('plays the recorded file even when the day film is longer than ten minutes', () => {
    const start = verifierHtml.indexOf('function startLivePlayback(item)');
    const end = verifierHtml.indexOf('function renderAnalysis(item)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = verifierHtml.slice(start, end);
    expect(body.indexOf("querySelector('video')")).toBeLessThan(body.indexOf('> 600'));
    expect(body).toContain('vid.muted = true');
  });
});
