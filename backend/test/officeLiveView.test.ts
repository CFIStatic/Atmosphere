import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contiguousPartIndexes,
  isLiveSessionFresh,
  LIVE_SESSION_STALE_MS,
  parsePartIndexName,
  presentLiveSession,
  type LiveSessionRow,
} from '../src/live/officeLiveView.js';

test('parsePartIndexName reads padded part object names', () => {
  assert.equal(parsePartIndexName('0000'), 0);
  assert.equal(parsePartIndexName('0003'), 3);
  assert.equal(parsePartIndexName('0012.webm'), 12);
  assert.equal(parsePartIndexName('nope'), null);
  assert.equal(parsePartIndexName(''), null);
});

test('contiguousPartIndexes stops at the first gap', () => {
  assert.deepEqual(contiguousPartIndexes([0, 1, 2, 4]), [0, 1, 2]);
  assert.deepEqual(contiguousPartIndexes([1, 2]), []);
  assert.deepEqual(contiguousPartIndexes([0]), [0]);
  assert.deepEqual(contiguousPartIndexes([]), []);
});

test('isLiveSessionFresh respects the stale window', () => {
  const now = Date.parse('2026-09-15T12:00:00.000Z');
  assert.equal(isLiveSessionFresh('2026-09-15T11:50:00.000Z', now), true);
  assert.equal(
    isLiveSessionFresh(new Date(now - LIVE_SESSION_STALE_MS - 1).toISOString(), now),
    false,
  );
  assert.equal(isLiveSessionFresh(null, now), false);
});

test('presentLiveSession hides ended or stale rows', () => {
  const base: LiveSessionRow = {
    id: 's1',
    org_id: 'o1',
    job_id: 'j1',
    party_id: 'p1',
    clip_id: 'clipab',
    storage_path: 'org/job/clip.webm',
    work_date: '2026-09-15',
    phase: 'before',
    extension: 'webm',
    mime_type: 'video/webm',
    status: 'live',
    last_mint_index: 2,
    started_at: '2026-09-15T11:00:00.000Z',
    last_part_at: new Date().toISOString(),
    ended_at: null,
  };
  const live = presentLiveSession(base);
  assert.ok(live);
  assert.equal(live!.clipId, 'clipab');
  assert.match(live!.latencyNote, /15–35/);
  assert.match(live!.privacyNote, /raw/);

  assert.equal(presentLiveSession({ ...base, status: 'ended' }), null);
  assert.equal(
    presentLiveSession({
      ...base,
      last_part_at: new Date(Date.now() - LIVE_SESSION_STALE_MS - 60_000).toISOString(),
    }),
    null,
  );
});
