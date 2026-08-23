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
    expect(fromApi).not.toContain('poster=');
    expect(fromApi).not.toContain('demo-preview');
  });

  it('asks the portal to cut the recorded file when the list has no signed clip yet', () => {
    expect(verifierHtml).toContain("e._remote && !e.previewUrl ? e.id : null");
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/preview');
    expect(verifierHtml).toContain('function resolvePreviewSrc');
    expect(verifierHtml).not.toContain('/verifier/demo-preview.mp4');
    expect(verifierHtml).not.toContain("o.previewUrl = '/verifier/demo-preview.mp4'");
  });
});
