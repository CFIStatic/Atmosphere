import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveSignalHub } from '../src/live/liveSignalHub.js';
import { buildIceServers } from '../src/live/iceServers.js';

test('LiveSignalHub reports no publisher until peers join', () => {
  const hub = new LiveSignalHub();
  assert.equal(hub.hasPublisher('org', 'job', 'clip01'), false);
  assert.deepEqual(hub.publisherClipIds('org', 'job'), []);
  assert.ok(hub.getIceServers().length >= 1);
  hub.close();
});

test('buildIceServers is stable for empty TURN env', () => {
  const a = buildIceServers({ LIVE_TURN_URLS: '' });
  const b = buildIceServers({});
  assert.equal(a.length, b.length);
});
