// Field Capture: stay signed in while backgrounded; sign in again only after
// a force close (cold launch) or Sign out. Run: node fieldcapture/js/app-session.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = readFileSync(join(here, 'capture-core.js'), 'utf8');
const appSrc = readFileSync(join(here, 'app.js'), 'utf8');
const sandbox = { navigator: {}, console, setTimeout, clearTimeout, URL, URLSearchParams, Blob, atob };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSrc, sandbox);
const Core = sandbox.FieldCaptureCore;

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}
const KEYS = { tokens: ['atm.field.accessToken', 'atm.field.refreshToken'], noAdopt: 'atm.field.noPlatformAdopt' };

// Where the per-launch rule applies.
const ctx = (o) => Object.assign({ navigator: {} }, o);
assert.equal(Core.isAppLaunchContext(ctx({ navigator: { userAgent: 'Mozilla/5.0 AtmosphereFieldCapture' } })), true, 'iPhone app UA');
assert.equal(Core.isAppLaunchContext(ctx({ Capacitor: { isNativePlatform: () => true } })), true, 'Capacitor native');
assert.equal(Core.isAppLaunchContext(ctx({ navigator: { standalone: true } })), true, 'iOS home-screen app');
assert.equal(Core.isAppLaunchContext(ctx({ matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) })), true, 'installed PWA');
assert.equal(Core.isAppLaunchContext(ctx({ navigator: { userAgent: 'Mozilla/5.0 Safari' }, matchMedia: () => ({ matches: false }) })), false, 'browser tab / desktop Platform untouched');

// Cold launch (after a force close): tokens cleared, no silent cookie sign-in.
{
  const s = memStore();
  s.setItem('atm.field.accessToken', 'a');
  s.setItem('atm.field.refreshToken', 'r');
  assert.equal(Core.claimColdAppLaunch(s, KEYS), true);
  assert.equal(s.getItem('atm.field.accessToken'), null);
  assert.equal(s.getItem('atm.field.refreshToken'), null);
  assert.equal(s.getItem('atm.field.noPlatformAdopt'), '1');
  // Same launch: resume from background / reload keeps the sign-in.
  s.setItem('atm.field.accessToken', 'a2');
  s.setItem('atm.field.refreshToken', 'r2');
  assert.equal(Core.claimColdAppLaunch(s, KEYS), false);
  assert.equal(Core.claimColdAppLaunch(s, KEYS), false);
  assert.equal(s.getItem('atm.field.accessToken'), 'a2');
  assert.equal(s.getItem('atm.field.refreshToken'), 'r2');
}
assert.equal(Core.claimColdAppLaunch(null, KEYS), false, 'no storage: never signs out');
assert.equal(
  Core.claimColdAppLaunch({ getItem() { throw new Error('blocked'); } }, KEYS),
  false,
  'storage blocked: never signs out',
);

// Long background: renew the access token before it lapses.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (exp) => `${b64u({ alg: 'HS256' })}.${b64u({ exp, sub: 'u' })}.sig`;
const now = 1_800_000_000_000;
assert.equal(Core.accessTokenExpiry(jwt(1_800_003_600)), 1_800_003_600);
assert.equal(Core.accessTokenExpiry('not-a-jwt'), null);
assert.equal(Core.accessTokenNeedsRefresh(jwt(now / 1000 + 3600), now), false, 'fresh token');
assert.equal(Core.accessTokenNeedsRefresh(jwt(now / 1000 + 60), now), true, 'ends within 5 min');
assert.equal(Core.accessTokenNeedsRefresh(jwt(now / 1000 - 7200), now), true, 'lapsed while backgrounded');
assert.equal(Core.accessTokenNeedsRefresh('opaque', now), false, 'unknown format: leave to 401 retry');

// app.js wiring.
assert.match(appSrc, /Core\.isAppLaunchContext\(window\)/, 'cold-start rule uses the shared context check');
assert.match(appSrc, /Core\.claimColdAppLaunch\(/, 'cold-start rule uses the shared launch marker');
assert.match(appSrc, /sessionStorage\.setItem\(ACCESS_KEY/, 'tokens stay in sessionStorage (cleared by a kill)');
assert.doesNotMatch(appSrc, /localStorage\.setItem\((ACCESS_KEY|REFRESH_KEY)/, 'tokens never in localStorage');
assert.match(appSrc, /visibilityState !== 'visible'\) return;\s*renewIfStale\(\);/, 'resume renews a stale token');

console.log('app-session tests passed');
