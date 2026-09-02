import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function scaleXOf(el: HTMLElement | null) {
  const match = /scaleX\(([^)]+)\)/.exec(el?.style.transform || '');
  return match ? Number(match[1]) : NaN;
}

function installPlaybackClock(dom: JSDOM) {
  const queued: Array<FrameRequestCallback | null> = [];
  const now = { t: 0 };
  const originalRaf = dom.window.requestAnimationFrame;
  const originalCancel = dom.window.cancelAnimationFrame;
  const originalNow = dom.window.performance.now.bind(dom.window.performance);
  dom.window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  }) as typeof requestAnimationFrame;
  dom.window.cancelAnimationFrame = ((id: number) => {
    if (id > 0 && id <= queued.length) queued[id - 1] = null;
  }) as typeof cancelAnimationFrame;
  Object.defineProperty(dom.window.performance, 'now', {
    configurable: true,
    value: () => now.t,
  });
  return {
    now,
    flush() {
      const pending = queued.splice(0);
      pending.forEach((cb) => {
        if (cb) cb(now.t);
      });
    },
    restore() {
      dom.window.requestAnimationFrame = originalRaf;
      dom.window.cancelAnimationFrame = originalCancel;
      Object.defineProperty(dom.window.performance, 'now', {
        configurable: true,
        value: originalNow,
      });
    },
  };
}

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

  it('labels uploaded clip length in the unit a person would say', () => {
    expect(verifierHtml).toContain('function durLabel');
    expect(verifierHtml).toContain('function knownDuration');
    expect(verifierHtml).toContain('function bindVideoDuration');
    expect(verifierHtml).toContain("parts.push(r === 1 ? '1 second' : r + ' seconds')");
    expect(verifierHtml).toContain("parts.push(m === 1 ? '1 minute' : m + ' minutes')");
    expect(verifierHtml).toContain('currentTime = Number.MAX_SAFE_INTEGER');
    expect(verifierHtml).toContain('if (!video.paused) return');
    expect(verifierHtml).toContain('video.currentTime = origin');
  });

  it('uses a compact 16:9 screenshot in the Preview column', () => {
    expect(verifierHtml).toContain('width: 112px; height: 63px');
    expect(verifierHtml).toContain('function capturedStill');
    expect(verifierHtml).toContain('function captureVideoScreenshot');
    expect(verifierHtml).toMatch(/th style="width:128px"[^>]*data-sort-key="preview"/);
  });

  it('gives the Ask chat a wider column so transcript lines are not cramped', () => {
    expect(verifierHtml).toContain('width: min(1280px, 100%)');
    const previewBody = verifierHtml.match(/\.screen-preview \.sheetbody \{[\s\S]*?\n  \}/);
    expect(previewBody?.[0]).toContain('minmax(420px, 1.15fr)');
    expect(previewBody?.[0]).not.toContain('minmax(300px, 0.8fr)');
    expect(verifierHtml).toContain('grid-template-columns: minmax(0, 1.35fr) minmax(400px, 1.1fr)');
  });

  it('opens the clip as a liquid-glass overlay over the dashboard', () => {
    expect(verifierHtml).toContain('id="screen-dashboard"');
    expect(verifierHtml).toMatch(/id="detail"[^>]*role="dialog"/);
    expect(verifierHtml).toContain('class="screen screen-preview"');
    expect(verifierHtml).toContain('class="liquid-glass"');
    expect(verifierHtml).toContain('class="preview-pane"');
    expect(verifierHtml).toContain('class="preview-pane-fill"');
    expect(verifierHtml).toContain('border: 2px solid var(--line)');
    expect(verifierHtml).toMatch(/id="d-back"[\s\S]*back-label[\s\S]*Dashboard[\s\S]*<\/button>/);
    expect(verifierHtml).toContain('class="side"');
    expect(verifierHtml).toContain('backdrop-filter: blur(6px) saturate(120%)');
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

  it('keeps the outer overlay frosted and the video perimeter plus chat solid', () => {
    const pane = verifierHtml.match(/\.screen-preview \.preview-pane \{[\s\S]*?\n  \}/);
    const fill = verifierHtml.match(/\.screen-preview \.preview-pane-fill \{[\s\S]*?\n  \}/);
    const side = verifierHtml.match(/\.screen-preview \.side \{[\s\S]*?\n  \}/);
    const glass = verifierHtml.match(/\.screen-preview \.liquid-glass \{[\s\S]*?\n  \}/);

    expect(glass?.[0]).toContain('backdrop-filter: blur(6px) saturate(120%)');
    expect(pane?.[0]).toContain('background: var(--panel)');
    expect(pane?.[0]).toContain('border: 2px solid var(--line)');
    expect(pane?.[0]).not.toContain('background: transparent');
    expect(fill?.[0]).toContain('background: var(--panel)');
    expect(fill?.[0]).not.toMatch(/backdrop-filter:\s*blur/);
    expect(side?.[0]).toContain('background: var(--bg)');
    expect(side?.[0]).toContain('border: 1px solid var(--line)');
    expect(side?.[0]).not.toMatch(/backdrop-filter:\s*blur/);
    expect(side?.[0]).not.toContain('--glass-panel');
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

    document
      .getElementById('d-back')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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

  it('stacks the phone clip viewer: video above notes, no two-column squeeze', () => {
    expect(verifierHtml).toContain(
      'Phone / Field Capture: full-screen clip, video above the notes.',
    );
    expect(verifierHtml).toContain('.screen-preview .sheethead .id { display: none; }');
    expect(verifierHtml).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(verifierHtml).toContain('aspect-ratio: 9 / 16');
    expect(verifierHtml).toContain('.screen-preview .back-label { display: none; }');
    expect(verifierHtml).toContain('class="meta-line"');
  });

  it('keeps a compositor progress line on the clip that glides with playback', () => {
    expect(verifierHtml).toContain('id="d-progress"');
    expect(verifierHtml).toContain('class="progress-line"');
    expect(verifierHtml).toContain('id="d-progress-fill"');
    expect(verifierHtml).toContain('id="d-scrub-fill"');
    expect(verifierHtml).toContain('function startProgressLoop');
    expect(verifierHtml).toContain('function setProgressRatio');
    expect(verifierHtml).toContain('requestAnimationFrame');
    expect(verifierHtml).toContain('transform-origin: left center');
    expect(verifierHtml).toContain('will-change: transform');
    expect(verifierHtml).not.toContain("$('#d-scrub').innerHTML = ''");
    expect(verifierHtml).not.toContain("$('#d-scrub').innerHTML = item._frames.map");
  });

  it('advances the progress line smoothly while a demo clip plays', async () => {
    const queued: FrameRequestCallback[] = [];
    const now = { t: 0 };
    const dom = bootVerifier();
    const originalRaf = dom.window.requestAnimationFrame;
    const originalNow = dom.window.performance.now.bind(dom.window.performance);
    dom.window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof requestAnimationFrame;
    Object.defineProperty(dom.window.performance, 'now', {
      configurable: true,
      value: () => now.t,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const fill = document.getElementById('d-progress-fill');
    const scrub = document.getElementById('d-scrub-fill');
    expect(document.getElementById('d-progress')).not.toBeNull();
    expect(fill).not.toBeNull();
    expect(scrub).not.toBeNull();
    expect(fill!.style.transform === '' || fill!.style.transform === 'scaleX(0)').toBe(true);
    expect(document.getElementById('d-progress')?.getAttribute('aria-valuenow')).toBe('0');

    document
      .getElementById('d-yt-play')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    now.t = 71500;
    const pending = queued.splice(0);
    pending.forEach((cb) => cb(now.t));

    expect(fill!.style.transform).toBe('scaleX(0.5)');
    expect(scrub!.style.transform).toBe('scaleX(0.5)');
    expect(document.getElementById('d-progress')?.getAttribute('aria-valuenow')).toBe('50');
    expect(document.getElementById('d-time')?.textContent).toMatch(/1:12\s*\/\s*2:23/);

    const line = document.getElementById('d-progress') as HTMLElement;
    Object.defineProperty(line, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        width: 200,
        top: 0,
        right: 200,
        bottom: 16,
        height: 16,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });
    line.dispatchEvent(new dom.window.PointerEvent('pointerdown', { clientX: 50, bubbles: true }));
    expect(fill!.style.transform).toBe('scaleX(0.25)');
    expect(document.getElementById('d-progress')?.getAttribute('aria-valuenow')).toBe('25');

    dom.window.requestAnimationFrame = originalRaf;
    Object.defineProperty(dom.window.performance, 'now', {
      configurable: true,
      value: originalNow,
    });
    dom.window.close();
  });

  it('starts playback from a pre-play scrub instead of jumping back to zero', async () => {
    const dom = bootVerifier();
    const clock = installPlaybackClock(dom);
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const fill = document.getElementById('d-progress-fill');
    const line = document.getElementById('d-progress') as HTMLElement;
    Object.defineProperty(line, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        width: 200,
        top: 0,
        right: 200,
        bottom: 16,
        height: 16,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });
    line.dispatchEvent(new dom.window.PointerEvent('pointerdown', { clientX: 50, bubbles: true }));
    dom.window.dispatchEvent(
      new dom.window.PointerEvent('pointerup', { clientX: 50, bubbles: true }),
    );
    expect(fill!.style.transform).toBe('scaleX(0.25)');

    document
      .getElementById('d-yt-play')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    clock.now.t = 1000;
    clock.flush();

    expect(scaleXOf(fill)).toBeCloseTo(36.75 / 143, 5);
    expect(document.getElementById('d-progress')?.getAttribute('aria-valuenow')).toBe('26');
    expect(document.getElementById('d-time')?.textContent).toMatch(/0:37\s*\/\s*2:23/);

    clock.restore();
    dom.window.close();
  });

  it('does not add idle time after a paused demo scrub', async () => {
    const dom = bootVerifier();
    const clock = installPlaybackClock(dom);
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    document
      .getElementById('d-yt-play')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    clock.now.t = 20000;
    clock.flush();

    document
      .getElementById('d-play')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const fill = document.getElementById('d-progress-fill');
    const line = document.getElementById('d-progress') as HTMLElement;
    Object.defineProperty(line, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        width: 200,
        top: 0,
        right: 200,
        bottom: 16,
        height: 16,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });
    line.dispatchEvent(new dom.window.PointerEvent('pointerdown', { clientX: 50, bubbles: true }));
    dom.window.dispatchEvent(
      new dom.window.PointerEvent('pointerup', { clientX: 50, bubbles: true }),
    );
    expect(scaleXOf(fill)).toBeCloseTo(0.25, 1);

    clock.now.t = 50000;
    clock.flush();
    expect(scaleXOf(fill)).toBeCloseTo(0.25, 1);

    document
      .getElementById('d-play')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    clock.now.t = 51000;
    clock.flush();

    expect(scaleXOf(fill)).toBeCloseTo(36.75 / 143, 5);
    expect(document.getElementById('d-time')?.textContent).toMatch(/0:37\s*\/\s*2:23/);

    clock.restore();
    dom.window.close();
  });

  it('keeps the demo progress line at the end after the last frame', async () => {
    const dom = bootVerifier();
    const clock = installPlaybackClock(dom);
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    document
      .getElementById('d-yt-play')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    clock.now.t = 143000;
    clock.flush();
    clock.flush();

    const fill = document.getElementById('d-progress-fill');
    expect(fill!.style.transform).toBe('scaleX(1)');
    expect(document.getElementById('d-progress')?.getAttribute('aria-valuenow')).toBe('100');
    expect(document.getElementById('d-time')?.textContent).toMatch(/2:23\s*\/\s*2:23/);

    clock.restore();
    dom.window.close();
  });
});
