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

assert.equal(Core.HOLD_TO_FINISH_MS, 5000, 'hold-to-finish must be 5 seconds');
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

console.log('hold-to-finish OK');
