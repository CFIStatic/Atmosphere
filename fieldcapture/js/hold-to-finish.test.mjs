import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = readFileSync(join(here, 'capture-core.js'), 'utf8');
const appSrc = readFileSync(join(here, 'app.js'), 'utf8');
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const sandbox = { navigator: {}, console, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSrc, sandbox);
const Core = sandbox.FieldCaptureCore;

assert.equal(typeof Core.bindLivePreview, 'function', 'iPhone preview needs bindLivePreview');
assert.equal(Core.HOLD_TO_FINISH_MS, 5000, 'hold-to-finish must be 5 seconds');

const fakeVideo = {
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  play() { this.played = true; return Promise.resolve(); },
};
Core.bindLivePreview(fakeVideo, {});
assert.equal(fakeVideo.playsInline, true);
assert.equal(fakeVideo.muted, true);
assert.ok(fakeVideo.srcObject);
assert.ok(fakeVideo.played, 'preview must call play() so iOS does not stay black');
assert.ok('playsinline' in fakeVideo.attributes);
assert.ok('webkit-playsinline' in fakeVideo.attributes);
assert.equal(Core.resolveFinishHold({ recorder: { stop() {} } }), 'live');
assert.equal(Core.resolveFinishHold({ recorder: null, demoFinish: () => {} }), 'demo');
assert.equal(
  Core.resolveFinishHold({}),
  null,
  'without a recorder or demo callback, hold must not invent a finish',
);
assert.equal(
  Core.resolveFinishHold({ demoFinish: () => {} }),
  'demo',
  'demo finish is the fallback only when no recorder is running',
);

assert.match(appSrc, /Core\.resolveFinishHold/, 'account and token days both finish through the recorder');
assert.doesNotMatch(
  appSrc,
  /if \(LIVE\) finishLiveDay/,
  'signed-in crew used to hold forever because finish required ?token=',
);
assert.match(html, /transition: width 5s linear/, 'fill bar must last the full 5s hold');
assert.match(html, /Hold 5 seconds to finish/);
assert.match(html, /id="preview"/);
assert.match(html, /webkit-playsinline/);
assert.match(html, /#preview \{/);
assert.match(html, /body\[data-screen="s-rec"\]/);
assert.match(html, /<span class="reclabel">REC<\/span>/);
assert.match(html, /id="clock"/);
assert.doesNotMatch(html, /ON THE RECORD/);
assert.doesNotMatch(html, /class="grain"/);
assert.doesNotMatch(html, /Filming for/);
assert.doesNotMatch(html, /RECORDING THE DAY/);
assert.doesNotMatch(appSrc, /preview\.hidden = true/);
assert.match(appSrc, /data-screen/);
assert.match(appSrc, /Core\.bindLivePreview/);

assert.equal(typeof Core.resolveApiBase, 'function');
assert.equal(Core.isStandaloneFieldCaptureHost('field-capture-production.up.railway.app'), true);
assert.equal(Core.isStandaloneFieldCaptureHost('field-capture.up.railway.app'), true);
assert.equal(Core.isStandaloneFieldCaptureHost('atmosphere-web-production.up.railway.app'), false);
assert.equal(Core.isStandaloneFieldCaptureHost('fieldcapture-production.up.railway.app'), false);
assert.equal(Core.resolveApiBase('https://example.test/api/'), 'https://example.test/api');
assert.equal(Core.resolveApiBase(''), '');
assert.match(appSrc, /Core\.resolveApiBase/, 'standalone Field Capture must pick the office API');

const coreAssignIndex = appSrc.indexOf('var Core = window.FieldCaptureCore');
const resolveIndex = appSrc.indexOf('Core.resolveApiBase');
assert.ok(coreAssignIndex >= 0, 'app.js must assign FieldCaptureCore');
assert.ok(
  resolveIndex > coreAssignIndex,
  'resolveApiBase must run after Core is assigned so the connect screen can boot',
);
assert.match(html, /id="daybtn"/, 'Today must keep the Start the day record button');
assert.match(html, /Start the day/);
assert.match(html, /id="s-home"[^>]*data-on="0"/, 'home stays hidden until a phone is linked');
assert.match(html, /id="s-blocked"[^>]*data-on="1"/, 'connect form is the default first screen');
assert.match(html, /id="product-switch"/, 'home keeps the Field Capture / Platform bar');
assert.match(html, /Field Capture<small>/);
assert.match(html, /Platform<small>/);
assert.equal(typeof Core.resolveOfficePlatformHref, 'function');
assert.match(appSrc, /resolveOfficePlatformHref/, 'Platform tab must point at the office Overview');
assert.match(html, /Connect Field Capture/);
assert.match(html, /Office invite code/);
assert.match(html, /id="login-name"/);
assert.match(html, /id="login-code"/);
assert.match(html, /<button class="daybtn" type="submit" id="login-btn">/);
assert.match(html, /js\/capture-core\.js\?v=jobs-always/);
assert.match(html, /js\/app\.js\?v=jobs-always/);
assert.doesNotMatch(html, /This week/);
assert.doesNotMatch(html, /week-wrap/);
assert.doesNotMatch(appSrc, /week-wrap/);
assert.match(html, /\.daybtn:disabled/);
assert.match(html, /class="home-scroll"/, 'Today must scroll independently of Start the day');
assert.match(html, /class="joblist"/, 'jobs must live in a scrollable list');
assert.match(html, /id="job-hint"/);
assert.doesNotMatch(html, /sharelink/, 'job cards must not show raw share URLs');
assert.doesNotMatch(appSrc, /sharelink/);
assert.doesNotMatch(appSrc, /hrefAttr/);
assert.match(appSrc, /role="option"/, 'assigned jobs are tappable options, not links');
assert.match(appSrc, /function jobMetaLine/, 'job cards show address, not a URL');

console.log('hold-to-finish OK');
