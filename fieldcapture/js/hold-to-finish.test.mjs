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

console.log('hold-to-finish OK');
