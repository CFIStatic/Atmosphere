import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const fieldHtml = readFileSync(resolve(repoRoot, 'fieldcapture/index.html'), 'utf8');
const fieldApp = readFileSync(resolve(repoRoot, 'fieldcapture/js/app.js'), 'utf8');
const coreSrc = readFileSync(resolve(repoRoot, 'fieldcapture/js/capture-core.js'), 'utf8');
const bridgeSrc = readFileSync(resolve(repoRoot, 'fieldcapture/js/native-bridge.js'), 'utf8');

type FakeCap = {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
  nativePromise: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
};

function makeDom() {
  return new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://app.atmosphereteam.com/',
  });
}

function setHidden(dom: JSDOM, hidden: boolean) {
  Object.defineProperty(dom.window.document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
}

function finishNowSpy(dom: JSDOM) {
  const reasons: string[] = [];
  dom.window.document.addEventListener('fieldcapture:finish-now', (ev) => {
    reasons.push((ev as CustomEvent).detail?.reason || '');
  });
  return reasons;
}

function fakeCapacitor(): FakeCap {
  return {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    nativePromise: vi.fn(() => Promise.resolve({})),
    addListener: vi.fn(),
  };
}

function fakeTrack(win: JSDOM['window']) {
  const target = new win.EventTarget() as EventTarget & { muted: boolean; readyState: string };
  target.muted = false;
  target.readyState = 'live';
  return target;
}

const doms: JSDOM[] = [];
afterEach(() => {
  doms.splice(0).forEach((d) => d.window.close());
});

describe('Field Capture app-shell bridge (Capacitor)', () => {
  it('does nothing in a normal browser', () => {
    const dom = makeDom();
    doms.push(dom);
    dom.window.eval(bridgeSrc);
    const reasons = finishNowSpy(dom);
    expect(
      (dom.window as unknown as { __fieldCaptureNativeBridge?: unknown })
        .__fieldCaptureNativeBridge,
    ).toBeUndefined();
    dom.window.document.dispatchEvent(
      new dom.window.CustomEvent('fieldcapture:recording-start', { detail: {} }),
    );
    setHidden(dom, true);
    expect(reasons).toEqual([]);
    expect(dom.window.document.documentElement.hasAttribute('data-native-app')).toBe(false);
  });

  it('does nothing when Capacitor is present but not native (web build)', () => {
    const dom = makeDom();
    doms.push(dom);
    const cap = { ...fakeCapacitor(), isNativePlatform: () => false };
    (dom.window as unknown as { Capacitor: unknown }).Capacitor = cap;
    dom.window.eval(bridgeSrc);
    const reasons = finishNowSpy(dom);
    dom.window.document.dispatchEvent(
      new dom.window.CustomEvent('fieldcapture:recording-start', { detail: {} }),
    );
    setHidden(dom, true);
    expect(reasons).toEqual([]);
    expect(cap.nativePromise).not.toHaveBeenCalled();
  });

  it('keeps the screen awake while recording and lets it sleep after', () => {
    const dom = makeDom();
    doms.push(dom);
    const cap = fakeCapacitor();
    (dom.window as unknown as { Capacitor: unknown }).Capacitor = cap;
    dom.window.eval(bridgeSrc);
    const doc = dom.window.document;
    doc.dispatchEvent(new dom.window.CustomEvent('fieldcapture:recording-start', { detail: {} }));
    expect(cap.nativePromise).toHaveBeenLastCalledWith('KeepAwake', 'keepAwake', {});
    doc.dispatchEvent(
      new dom.window.CustomEvent('fieldcapture:recording-stop', { detail: { saved: true } }),
    );
    expect(cap.nativePromise).toHaveBeenLastCalledWith('KeepAwake', 'allowSleep', {});
    expect(doc.documentElement.getAttribute('data-native-app')).toBe('ios');
  });

  it('finishes the day when the phone locks or the app leaves the foreground — only while recording', () => {
    const dom = makeDom();
    doms.push(dom);
    const cap = fakeCapacitor();
    (dom.window as unknown as { Capacitor: unknown }).Capacitor = cap;
    dom.window.eval(bridgeSrc);
    const reasons = finishNowSpy(dom);
    const doc = dom.window.document;

    setHidden(dom, true);
    expect(reasons).toEqual([]);
    setHidden(dom, false);

    doc.dispatchEvent(new dom.window.CustomEvent('fieldcapture:recording-start', { detail: {} }));
    setHidden(dom, true);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/phone locked/);

    expect(cap.addListener).toHaveBeenCalledWith('App', 'pause', expect.any(Function));
    const onPause = cap.addListener.mock.calls.find(
      (c) => c[0] === 'App' && c[1] === 'pause',
    )![2] as () => void;
    onPause();
    expect(reasons).toHaveLength(2);

    doc.dispatchEvent(new dom.window.CustomEvent('fieldcapture:recording-stop', { detail: {} }));
    onPause();
    setHidden(dom, true);
    expect(reasons).toHaveLength(2);
  });

  it('finishes the day when a call or another app takes the camera or microphone', () => {
    vi.useFakeTimers();
    try {
      const dom = makeDom();
      doms.push(dom);
      const cap = fakeCapacitor();
      (dom.window as unknown as { Capacitor: unknown }).Capacitor = cap;
      // The bridge uses the window's timers; point them at the fake clock.
      (dom.window as unknown as { setTimeout: typeof setTimeout }).setTimeout = setTimeout;
      (dom.window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = clearTimeout;
      dom.window.eval(bridgeSrc);
      const reasons = finishNowSpy(dom);
      const audio = fakeTrack(dom.window);
      const video = fakeTrack(dom.window);
      const stream = { getTracks: () => [audio, video] };
      dom.window.document.dispatchEvent(
        new dom.window.CustomEvent('fieldcapture:recording-start', { detail: { stream } }),
      );

      // A brief mute (audio route change) that clears is ignored.
      audio.muted = true;
      audio.dispatchEvent(new dom.window.Event('mute'));
      audio.muted = false;
      vi.advanceTimersByTime(2000);
      expect(reasons).toEqual([]);

      // A mute that lasts finishes the day.
      audio.muted = true;
      audio.dispatchEvent(new dom.window.Event('mute'));
      vi.advanceTimersByTime(2000);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/camera or microphone/);

      video.dispatchEvent(new dom.window.Event('ended'));
      expect(reasons).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Field Capture app-shell location', () => {
  it('leaves navigator.geolocation alone without the Geolocation plugin', () => {
    const dom = makeDom();
    doms.push(dom);
    const before = dom.window.navigator.geolocation;
    (dom.window as unknown as { Capacitor: unknown }).Capacitor = fakeCapacitor();
    dom.window.eval(bridgeSrc);
    expect(dom.window.navigator.geolocation).toBe(before);
  });

  it('answers getCurrentPosition / watchPosition / clearWatch from the native plugin', async () => {
    const dom = makeDom();
    doms.push(dom);
    const cap = {
      ...fakeCapacitor(),
      PluginHeaders: [{ name: 'App' }, { name: 'Geolocation' }, { name: 'KeepAwake' }],
      nativeCallback: vi.fn(() => 'native-cb-7'),
    };
    cap.nativePromise = vi.fn((_plugin: string, method: string) =>
      method === 'getCurrentPosition'
        ? Promise.resolve({
            timestamp: 5,
            coords: { latitude: 41.8, longitude: -87.6, accuracy: 12 },
          })
        : Promise.resolve({}),
    );
    (dom.window as unknown as { Capacitor: unknown }).Capacitor = cap;
    dom.window.eval(bridgeSrc);
    const geo = dom.window.navigator.geolocation;

    const got = await new Promise<GeolocationPosition>((resolveP, rejectP) =>
      geo.getCurrentPosition(resolveP, rejectP, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }),
    );
    expect(got.coords.latitude).toBe(41.8);
    expect(got.coords.accuracy).toBe(12);
    expect(cap.nativePromise).toHaveBeenCalledWith('Geolocation', 'getCurrentPosition', {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000,
    });

    const seen: number[] = [];
    const errors: number[] = [];
    const id = geo.watchPosition(
      (p) => seen.push(p.coords.longitude),
      (e) => errors.push(e.code),
      { enableHighAccuracy: true, maximumAge: 15000 },
    );
    const cb = cap.nativeCallback.mock.calls[0]![3] as (data: unknown, err?: unknown) => void;
    cb({ timestamp: 1, coords: { latitude: 1, longitude: 2, accuracy: 3 } });
    cb(null, { message: 'Location permission request was denied.' });
    expect(seen).toEqual([2]);
    expect(errors).toEqual([1]);

    geo.clearWatch(id);
    expect(cap.nativePromise).toHaveBeenLastCalledWith('Geolocation', 'clearWatch', {
      id: 'native-cb-7',
    });
    cb({ timestamp: 2, coords: { latitude: 1, longitude: 9, accuracy: 3 } });
    expect(seen).toEqual([2]);
  });
});

describe('Field Capture web app hooks for the app shell', () => {
  it('loads the bridge after app.js', () => {
    const app = fieldHtml.indexOf('<script src="js/app.js');
    const bridge = fieldHtml.indexOf('<script src="js/native-bridge.js');
    expect(app).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(app);
  });

  it('announces recording start/stop and finishes on request without the hold', () => {
    expect(fieldApp).toContain("announceRecording('start', { stream: stream })");
    expect(fieldApp).toContain("announceRecording('stop', { saved: true })");
    expect(fieldApp).toContain("announceRecording('stop', { saved: false })");
    expect(fieldApp).toMatch(
      /addEventListener\('fieldcapture:finish-now'[\s\S]{0,200}finishLiveDay\(/,
    );
    expect(fieldHtml).toMatch(/<p class="sub" id="door-stop-note" hidden><\/p>/);
  });
});

describe('Field Capture Delete account', () => {
  it('adds Delete account to the account menu after Sign out, hidden until signed in', () => {
    const dom = new JSDOM(fieldHtml);
    const menu = dom.window.document.getElementById('who-menu')!;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.id);
    expect(items.indexOf('fc-menu-delete')).toBe(items.indexOf('fc-menu-signout') + 1);
    const del = dom.window.document.getElementById('fc-menu-delete')!;
    expect(del.textContent).toBe('Delete account');
    expect(del.hasAttribute('hidden')).toBe(true);
    expect(fieldApp).toContain('if (deleteAccount) deleteAccount.hidden = !accountActions;');
    expect(fieldApp).toContain("menuDelete.addEventListener('click', deleteFieldAccount)");
  });

  it('confirms in an in-page dialog, calls DELETE /api/auth/account, and signs out locally', () => {
    const dom = new JSDOM(fieldHtml);
    const dialog = dom.window.document.getElementById('fc-delete-dialog')!;
    expect(dialog.hasAttribute('hidden')).toBe(true);
    expect(dialog.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(dialog.textContent).toContain('It cannot be undone.');
    expect(dialog.textContent).toContain('stay with it');
    expect(dom.window.document.getElementById('fc-delete-confirm')!.textContent).toBe('Delete my account');
    expect(dom.window.document.getElementById('fc-delete-cancel')!.textContent).toBe('Cancel');

    const start = fieldApp.indexOf('var deleteDialog = ');
    const body = fieldApp.slice(start, fieldApp.indexOf('var whoBtn', start));
    expect(body).not.toContain('window.confirm');
    expect(body).toContain('deleteDialog.hidden = false;');
    expect(body).toContain('Core.deleteAccount(API_BASE, accessToken)');
    expect(body.indexOf('finishAccountDeleted(result')).toBeGreaterThan(body.indexOf('.then('));
    const finish = body.slice(body.indexOf('function finishAccountDeleted'), body.indexOf('function deleteFieldAccount'));
    expect(finish).toContain('writeStoredSession(null, null)');
    expect(finish.indexOf('showBlockedMsg(')).toBeGreaterThan(finish.indexOf('bootBlocked()'));
    expect(body).toContain('deleteErrorNote.textContent');
  });

  it('signs Field Capture out when Settings in the office frame deletes the account', () => {
    expect(fieldApp).toMatch(/data\.atmosphere === 'account-deleted'\) \{\s*finishAccountDeleted\(\);/);
  });

  it('Core.deleteAccount sends DELETE with the bearer token and surfaces last_admin', async () => {
    const calls: Array<[string, RequestInit]> = [];
    let reply: Response = new Response(JSON.stringify({ ok: true, mode: 'deleted' }), {
      status: 200,
    });
    const sandbox: Record<string, unknown> = {
      console,
      URL,
      URLSearchParams,
      fetch: (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return Promise.resolve(reply);
      },
      location: { hostname: 'app.atmosphereteam.com', pathname: '/', search: '' },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(coreSrc, sandbox);
    const Core = sandbox.FieldCaptureCore as {
      deleteAccount: (apiBase: string, token: string) => Promise<{ ok: boolean }>;
    };

    await expect(Core.deleteAccount('', 'tok-1')).resolves.toMatchObject({ ok: true });
    expect(calls[0]![0]).toBe('/api/auth/account');
    expect(calls[0]![1].method).toBe('DELETE');
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(calls[0]![1].credentials).toBe('include');

    reply = new Response(
      JSON.stringify({ error: 'Make someone else an admin first.', code: 'last_admin' }),
      { status: 409 },
    );
    const err = (await Core.deleteAccount('https://platform.atmosphereteam.com/', 'tok-1').catch(
      (e: unknown) => e,
    )) as Error & { status?: number; code?: string };
    expect(calls[1]![0]).toBe('https://platform.atmosphereteam.com/api/auth/account');
    expect(err.message).toBe('Make someone else an admin first.');
    expect(err.status).toBe(409);
    expect(err.code).toBe('last_admin');
  });
});
