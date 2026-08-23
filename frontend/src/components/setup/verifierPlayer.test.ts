import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function slice(from: string, to: string): string {
  const start = verifierHtml.indexOf(from);
  const end = verifierHtml.indexOf(to);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Could not find ${from} … ${to} in verifier/index.html`);
  }
  return verifierHtml.slice(start, end);
}

type Clip = Record<string, unknown>;

/** The preview cell, with its drawing and formatting helpers stubbed. */
function previewCell() {
  const body = slice('  function drawnFrame(item) {', '  function clipRow(e) {');
  return new Function(
    'frameSVG',
    'esc',
    'dur',
    `${body}; return { drawnFrame, stillFor, thumbFor, thumbCell, rememberShot, SHOTS };`,
  )(
    () => 'data:image/svg+xml;charset=utf-8,DRAWN',
    (s: unknown) => String(s),
    (s: unknown) => (s == null ? '—' : `${s}s`),
  ) as {
    drawnFrame: (item: Clip) => string;
    stillFor: (item: Clip) => string | null;
    thumbFor: (item: Clip) => string;
    thumbCell: (item: Clip) => string;
    rememberShot: (id: string, dataUrl: string) => void;
    SHOTS: Record<string, string>;
  };
}

/** The player itself, with everything outside it injected. */
function player(overrides: Record<string, unknown> = {}) {
  const body = slice('  var RATES = [0.5, 1, 1.25, 1.5, 2];', '   * Stills out of the footage')
    // The trailing comment opener the slice leaves behind.
    .replace(/\/\* -+ \*\n?$/, '');
  const deps = {
    $: (sel: string) => document.querySelector(sel),
    esc: (s: unknown) => String(s),
    dur: (s: unknown) => String(s),
    stillFor: () => null,
    analysisLog: () => [] as Array<{ at: number; text: string; kind: string }>,
    syncAnalysisLog: () => {},
    harvestStill: () => {},
    refreshThumb: () => {},
    state: { open: null as Clip | null },
    ...overrides,
  };
  const names = Object.keys(deps);
  return new Function(
    ...names,
    `${body}\n; return { mountPlayer, unmountPlayer, clock };`,
  )(...names.map((n) => (deps as Record<string, unknown>)[n])) as {
    mountPlayer: (item: Clip, url: string) => void;
    unmountPlayer: () => void;
    clock: (seconds: number) => string;
  };
}

function stageDom() {
  document.body.innerHTML =
    '<div class="player"><div class="frame" id="d-frame"></div>' +
    '<div class="controls"><div class="scrub" id="d-scrub"></div>' +
    '<span class="time" id="d-time"></span></div></div>';
}

/** jsdom has no media stack; these are the three bits the player touches. */
function fakeMedia(duration = 120) {
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get() {
      return duration;
    },
  });
  let paused = true;
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() {
      return paused;
    },
  });
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  };
}

describe('verifier preview cell', () => {
  it('never draws a picture for a clip that has real footage behind it', () => {
    const { thumbCell, stillFor } = previewCell();
    const uploaded: Clip = { id: 'p1', _remote: true, duration: 43, poster: null };

    const cell = thumbCell(uploaded);
    expect(stillFor(uploaded)).toBeNull();
    expect(cell).toContain('thumb pending');
    expect(cell).not.toContain('DRAWN');
    expect(cell).not.toContain('<img');
  });

  it('previews an uploaded clip with the still the portal signed', () => {
    const { thumbCell, thumbFor } = previewCell();
    const uploaded: Clip = {
      id: 'p2',
      _remote: true,
      duration: 43,
      poster: 'https://storage.example/still.jpg?sig=1',
    };

    expect(thumbFor(uploaded)).toBe('https://storage.example/still.jpg?sig=1');
    expect(thumbCell(uploaded)).toContain('https://storage.example/still.jpg?sig=1');
    expect(thumbCell(uploaded)).not.toContain('DRAWN');
  });

  it('falls back to a still lifted out of the footage, and offers it as a hover clip', () => {
    const { thumbCell, rememberShot } = previewCell();
    const uploaded: Clip = {
      id: 'p3',
      _remote: true,
      duration: 43,
      poster: null,
      _videoUrl: 'https://storage.example/clip.mp4?sig=2',
    };

    rememberShot('p3', 'data:image/jpeg;base64,LIFTED');

    const cell = thumbCell(uploaded);
    expect(cell).toContain('data:image/jpeg;base64,LIFTED');
    expect(cell).toContain('data-clip="https://storage.example/clip.mp4?sig=2"');
    expect(cell).not.toContain('pending');
  });

  it('keeps the schematic for the demo artifact, which has no footage at all', () => {
    const { thumbCell } = previewCell();
    const demo: Clip = { id: 'EV-1038-0805-A', duration: 143, after: { wet: 0.1, cut: 0.6, gear: 0 } };

    expect(thumbCell(demo)).toContain('DRAWN');
    expect(thumbCell(demo)).not.toContain('pending');
  });
});

describe('verifier video timeline', () => {
  beforeEach(() => {
    stageDom();
    fakeMedia();
  });

  it('reads a length back as a clock, hours included', () => {
    const { clock } = player();
    expect(clock(0)).toBe('0:00');
    expect(clock(9)).toBe('0:09');
    expect(clock(143)).toBe('2:23');
    expect(clock(24480)).toBe('6:48:00');
  });

  it('mounts a seek bar, a clock and transport under the picture', () => {
    const { mountPlayer } = player();
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');

    const root = document.querySelector('.vp')!;
    expect(root).toBeTruthy();
    expect(root.querySelector('video')?.getAttribute('src')).toBe('https://storage.example/clip.mp4');
    expect(root.querySelector('.vp-bar')?.getAttribute('role')).toBe('slider');
    expect(root.querySelector('.vp-played')).toBeTruthy();
    expect(root.querySelector('.vp-buffered')).toBeTruthy();
    expect(root.querySelector('[data-vp="play"]')).toBeTruthy();
    expect(root.querySelector('[data-vp="mute"]')).toBeTruthy();
    expect(root.querySelector('[data-vp="full"]')).toBeTruthy();
    expect(root.querySelector('.vp-clock')?.textContent).toContain('/ 2:00');
    // The frame strip is the schematic player's; two scrubbers is one too many.
    expect((document.querySelector('.player .controls') as HTMLElement).hidden).toBe(true);
  });

  it('pins each note the assistant wrote at the second it describes', () => {
    const { mountPlayer } = player({
      analysisLog: () => [
        { at: 0, text: 'ignored — the bar starts here anyway', kind: 'read' },
        { at: 30, text: 'Tarp comes off the north slope.', kind: 'read' },
        { at: 90, text: 'remove — debris bagged at the driveway', kind: 'action' },
      ],
    });
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');

    const ticks = Array.from(document.querySelectorAll('.vp-tick')) as HTMLElement[];
    expect(ticks).toHaveLength(2);
    expect(parseFloat(ticks[0].style.left)).toBeCloseTo(25, 3);
    expect(parseFloat(ticks[1].style.left)).toBeCloseTo(75, 3);
    expect(ticks[1].getAttribute('data-kind')).toBe('action');
  });

  it('leaves the bar bare when the clip has no length to pin notes against', () => {
    const { mountPlayer } = player({
      analysisLog: () => [{ at: 30, text: 'Tarp comes off.', kind: 'read' }],
    });
    mountPlayer({ id: 'p1', duration: null }, 'https://storage.example/clip.mp4');

    expect(document.querySelectorAll('.vp-tick')).toHaveLength(0);
    expect(document.querySelector('.vp-bar')).toBeTruthy();
  });

  it('plays and pauses from the picture, the badge and the transport alike', () => {
    const { mountPlayer } = player();
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');

    const root = document.querySelector('.vp') as HTMLElement;
    expect(root.getAttribute('data-paused')).toBe('1');

    (root.querySelector('.vp-hit') as HTMLElement).click();
    expect(root.getAttribute('data-paused')).toBe('0');

    (root.querySelector('[data-vp="play"]') as HTMLElement).click();
    expect(root.getAttribute('data-paused')).toBe('1');

    (root.querySelector('.vp-big') as HTMLElement).click();
    expect(root.getAttribute('data-paused')).toBe('0');
  });

  it('nudges and mutes on the keys every video player already uses', () => {
    const seen: number[] = [];
    const { mountPlayer, unmountPlayer } = player({
      syncAnalysisLog: (s: number) => seen.push(s),
      state: { open: { id: 'p1' } },
    });
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');
    const video = document.querySelector('.vp video') as HTMLVideoElement;
    video.currentTime = 40;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(video.currentTime).toBe(45);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(video.currentTime).toBe(35);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    expect(video.currentTime).toBe(60);

    expect(video.muted).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    expect(video.muted).toBe(true);
    expect(seen.length).toBeGreaterThan(0);

    // Nothing is left listening once the sheet closes.
    unmountPlayer();
    video.currentTime = 10;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(video.currentTime).toBe(10);
  });

  it('leaves typing alone', () => {
    const { mountPlayer } = player({ state: { open: { id: 'p1' } } });
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');
    const video = document.querySelector('.vp video') as HTMLVideoElement;
    video.currentTime = 40;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(video.currentTime).toBe(40);
  });

  it('cycles playback speed the way a reviewer skimming a workday needs', () => {
    const { mountPlayer } = player();
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');
    const rate = document.querySelector('[data-vp="rate"]') as HTMLElement;
    const video = document.querySelector('.vp video') as HTMLVideoElement;

    expect(rate.textContent).toBe('1×');
    rate.click();
    expect(video.playbackRate).toBe(1.25);
    rate.click();
    expect(video.playbackRate).toBe(1.5);
  });

  it('takes the file’s own length over the one the list printed', () => {
    const refreshed: Clip[] = [];
    const { mountPlayer } = player({ refreshThumb: (i: Clip) => refreshed.push(i) });
    const item: Clip = { id: 'p1', duration: 0 };
    mountPlayer(item, 'https://storage.example/clip.mp4');

    const video = document.querySelector('.vp video') as HTMLVideoElement;
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(item.duration).toBe(120);
    expect(refreshed).toContain(item);
    expect(document.querySelector('.vp-clock')?.textContent).toContain('/ 2:00');
  });

  it('stops the footage when the sheet closes', () => {
    const { mountPlayer, unmountPlayer } = player();
    mountPlayer({ id: 'p1', duration: 120 }, 'https://storage.example/clip.mp4');
    const video = document.querySelector('.vp video') as HTMLVideoElement;
    const pause = vi.spyOn(video, 'pause');

    unmountPlayer();
    expect(pause).toHaveBeenCalled();
  });
});
