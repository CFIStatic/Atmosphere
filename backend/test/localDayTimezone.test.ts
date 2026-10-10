import test from 'node:test';
import assert from 'node:assert/strict';
import { sameDayCheck, verifyProof, type ProofUpload } from '../src/shared/proofVerifier.js';
import { localDateOf, localDayKey, resolveTimeZone, DEFAULT_TIME_ZONE } from '../src/lib/localDayKey.js';
import { summarizeProofPulse } from '../src/shared/proofPulse.js';
import { parseRoomLabel, roomDisplayName } from '../src/shared/roomIntelligence.js';
import { proofClipListLabel } from '../src/verifier/proofClipTitle.js';

/**
 * Days are local. A late-evening clip in any US zone is the next day in UTC,
 * and must never be flagged as filmed on the wrong day.
 */

const US_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

test('the production case: Oct 8, 7:12 PM CT is Oct 8, not Oct 9', () => {
  // job_proofs e4e95e5a: captured_at 2026-10-09 00:12:38Z, work_date 2026-10-08.
  const check = sameDayCheck('2026-10-09T00:12:38.476Z', '2026-10-08', 'America/Chicago');
  assert.equal(check.verdict, 'pass');
  assert.equal(localDateOf('2026-10-09T00:12:38.476Z', 'America/Chicago'), '2026-10-08');
});

for (const zone of US_ZONES) {
  test(`late-evening clip in ${zone} passes the same-day check`, () => {
    // 11:30 PM local on Mar 10 2026 (DST start weekend nearby) and Oct 8 2026.
    for (const workDate of ['2026-03-07', '2026-03-08', '2026-10-08', '2026-11-01', '2026-12-31']) {
      const lateLocal = new Date(`${workDate}T12:00:00Z`);
      // Walk forward until local day changes, then step back 30 minutes.
      let t = lateLocal.getTime();
      while (localDayKey(new Date(t), zone) === workDate) t += 15 * 60_000;
      const at = new Date(t - 30 * 60_000).toISOString();
      assert.equal(localDayKey(new Date(at), zone), workDate);
      const check = sameDayCheck(at, workDate, zone);
      assert.equal(check.verdict, 'pass', `${zone} ${workDate} ${at}: ${check.detail}`);
    }
  });

  test(`early-morning clip in ${zone} passes too`, () => {
    const workDate = '2026-10-08';
    let t = new Date(`${workDate}T12:00:00Z`).getTime();
    while (localDayKey(new Date(t), zone) === workDate) t -= 15 * 60_000;
    const at = new Date(t + 30 * 60_000).toISOString(); // ~12:15-12:30 AM local
    assert.equal(sameDayCheck(at, workDate, zone).verdict, 'pass');
  });
}

test('just after midnight still counts for the previous work day (late shift)', () => {
  // 1:30 AM CT Oct 9, filed under Oct 8.
  assert.equal(sameDayCheck('2026-10-09T06:30:00Z', '2026-10-08', 'America/Chicago').verdict, 'pass');
  // 6 AM CT Oct 9 filed under Oct 8 is a real mismatch.
  const real = sameDayCheck('2026-10-09T11:00:00Z', '2026-10-08', 'America/Chicago');
  assert.equal(real.verdict, 'fail');
  assert.match(real.detail, /Needs a look/);
  assert.doesNotMatch(real.detail, /failed/i);
});

test('real mismatches are still caught', () => {
  assert.equal(sameDayCheck('2026-10-05T18:00:00Z', '2026-10-08', 'America/Chicago').verdict, 'fail');
  // Filed a day AHEAD of filming is never excused.
  assert.equal(sameDayCheck('2026-10-08T03:00:00Z', '2026-10-08', 'America/Chicago').verdict, 'fail');
});

test('verifyProof uses the timeZone option', () => {
  const upload: ProofUpload = {
    id: 'u', phase: 'before', workDate: '2026-10-08',
    capturedAt: '2026-10-09T02:00:00Z', receivedAt: '2026-10-09T02:01:00Z',
    durationSeconds: 45, contentHash: 'h', lat: null, lon: null, accuracyM: null,
  };
  const ct = verifyProof(upload, null, { timeZone: 'America/Los_Angeles' });
  assert.equal(ct.find((c) => c.key === 'same_day')?.verdict, 'pass');
});

test('bad or missing zones fall back to the default, never UTC', () => {
  assert.equal(resolveTimeZone('Not/AZone', null, ''), DEFAULT_TIME_ZONE);
  assert.equal(localDateOf('2026-10-09T00:12:00Z', resolveTimeZone(null)), '2026-10-08');
  assert.equal(localDateOf('2026-10-08', 'Asia/Tokyo'), '2026-10-08');
});

test('proof pulse "filmed today" uses the org zone', () => {
  const now = new Date('2026-10-09T01:00:00Z'); // Oct 8, 8 PM CT
  const pulse = summarizeProofPulse(
    [{ jobId: 'j', analysisStatus: 'done', transcriptStatus: 'done', receivedAt: '2026-10-08T23:30:00Z', workDate: '2026-10-08' }],
    now,
    'America/Chicago',
  );
  assert.equal(pulse.filmedToday, 1);
});

test('living_room and living room are the same room', () => {
  assert.equal(roomDisplayName(parseRoomLabel('living_room')), 'living room');
  assert.equal(roomDisplayName(parseRoomLabel('Living-Room')), 'living room');
});

test('description-like titles become short clip names', () => {
  assert.equal(
    proofClipListLabel({ title: 'Short, Handheld Clip Filmed Inside a Home, Likely', workDate: '2026-10-08' }),
    'Walk-through · Oct 8',
  );
  assert.equal(proofClipListLabel({ title: 'Tear-off north slope', workDate: '2026-10-08' }), 'Tear-off north slope');
});
