import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyProof,
  verifyDay,
  payable,
  milesBetween,
  type ProofUpload,
} from '../src/shared/proofVerifier.js';

/**
 * Proof of work, when money moves against it.
 *
 * Every test here is somebody trying it on. That is the right way to read this
 * file: the feature is only worth having if the cheap frauds fail, and the
 * cheapest fraud of all is a video that proves nothing being called proof.
 */

const SITE = { lat: 30.5145, lon: -97.668 }; // Round Rock

const upload = (over: Partial<ProofUpload> = {}): ProofUpload => ({
  id: 'u1',
  phase: 'before',
  workDate: '2026-08-05',
  capturedAt: '2026-08-05T13:00:00Z',
  receivedAt: '2026-08-05T13:04:00Z',
  durationSeconds: 45,
  contentHash: 'aaa',
  lat: 30.5146,
  lon: -97.6679,
  accuracyM: 12,
  ...over,
});

const verdictFor = (checks: ReturnType<typeof verifyProof>, key: string) =>
  checks.find((c) => c.key === key)?.verdict;

test('a clean upload passes everything', () => {
  const checks = verifyProof(upload(), SITE);
  assert.ok(checks.every((c) => c.verdict === 'pass'), JSON.stringify(checks, null, 2));
});

test('filming a different house fails, and says how far', () => {
  // Two miles away — somewhere the crew may genuinely be working, which is
  // exactly why this has to be caught rather than trusted.
  const checks = verifyProof(upload({ lat: 30.545, lon: -97.63 }), SITE);
  const onSite = checks.find((c) => c.key === 'on_site');
  assert.equal(onSite?.verdict, 'fail');
  assert.match(onSite!.detail, /miles from the site/);
});

test('a poor GPS fix is not treated as a lie', () => {
  // Indoors, fix to the nearest tower. The video is 0.2 miles out with 800m of
  // reported accuracy; failing it would punish an honest sub for a basement.
  const checks = verifyProof(
    upload({ lat: 30.5175, lon: -97.6705, accuracyM: 800 }),
    SITE,
  );
  assert.equal(verdictFor(checks, 'on_site'), 'pass');
});

test('no location at all is unknown, never a pass', () => {
  // The single most damaging thing this feature could do is call an unproven
  // video verified.
  const checks = verifyProof(upload({ lat: null, lon: null }), SITE);
  const onSite = checks.find((c) => c.key === 'on_site');
  assert.equal(onSite?.verdict, 'unknown');
  assert.match(onSite!.detail, /allow location/);

  // And with no site on file, there is nothing to compare against either.
  assert.equal(verdictFor(verifyProof(upload(), null), 'on_site'), 'unknown');
});

test('a video filed against the wrong day is caught', () => {
  const checks = verifyProof(
    upload({ capturedAt: '2026-08-04T13:00:00Z', workDate: '2026-08-05' }),
    SITE,
  );
  const sameDay = checks.find((c) => c.key === 'same_day');
  assert.equal(sameDay?.verdict, 'fail');
  assert.match(sameDay!.detail, /filed against 2026-08-05/);
});

test('footage sat on for a week fails; a day on a bad signal does not', () => {
  const late = verifyProof(
    upload({ capturedAt: '2026-07-29T13:00:00Z', workDate: '2026-07-29', receivedAt: '2026-08-05T13:00:00Z' }),
    SITE,
  );
  assert.equal(verdictFor(late, 'uploaded_promptly'), 'fail');

  const overnight = verifyProof(
    upload({ capturedAt: '2026-08-04T18:00:00Z', workDate: '2026-08-04', receivedAt: '2026-08-05T09:00:00Z' }),
    SITE,
  );
  assert.equal(verdictFor(overnight, 'uploaded_promptly'), 'pass');
});

test('a device clock claiming the future is a failure, not a pass', () => {
  const checks = verifyProof(
    upload({ capturedAt: '2026-08-06T13:00:00Z', receivedAt: '2026-08-05T13:00:00Z' }),
    SITE,
  );
  assert.equal(verdictFor(checks, 'uploaded_promptly'), 'fail');
});

test('four seconds of a clean room is not a record', () => {
  assert.equal(verdictFor(verifyProof(upload({ durationSeconds: 4 }), SITE), 'long_enough'), 'fail');
  assert.equal(verdictFor(verifyProof(upload({ durationSeconds: 45 }), SITE), 'long_enough'), 'pass');
  assert.equal(
    verdictFor(verifyProof(upload({ durationSeconds: null }), SITE), 'long_enough'),
    'unknown',
  );
});

test("yesterday's after, re-filed as today's before, is caught by the hash", () => {
  const checks = verifyProof(upload({ contentHash: 'seen-before' }), SITE, {
    seenHashes: new Set(['seen-before']),
  });
  const reupload = checks.find((c) => c.key === 'not_a_reupload');
  assert.equal(reupload?.verdict, 'fail');
  assert.match(reupload!.detail, /byte-for-byte/);
});

test('no fingerprint means a re-upload cannot be ruled out, not that it is fine', () => {
  assert.equal(
    verdictFor(verifyProof(upload({ contentHash: null }), SITE), 'not_a_reupload'),
    'unknown',
  );
});

test('the same file filed as both before and after in one day is caught', () => {
  // No job history needed — the pair check catches it on its own.
  const day = verifyDay({
    workDate: '2026-08-05',
    before: upload({ id: 'b', phase: 'before', contentHash: 'same' }),
    after: upload({ id: 'a', phase: 'after', contentHash: 'same', capturedAt: '2026-08-05T21:00:00Z', receivedAt: '2026-08-05T21:05:00Z' }),
    site: SITE,
  });
  assert.ok(day.checks.some((c) => c.key === 'after.not_a_reupload' && c.verdict === 'fail'));
  assert.equal(day.contradicted, true);
});

test('an after filmed before the before is caught', () => {
  const day = verifyDay({
    workDate: '2026-08-05',
    before: upload({ id: 'b', capturedAt: '2026-08-05T17:00:00Z' }),
    after: upload({ id: 'a', phase: 'after', contentHash: 'bbb', capturedAt: '2026-08-05T09:00:00Z' }),
    site: SITE,
  });
  const ordered = day.checks.find((c) => c.key === 'ordered');
  assert.equal(ordered?.verdict, 'fail');
  assert.match(ordered!.detail, /filmed before the before/);
});

test('a good day reports the hours between the two videos', () => {
  const day = verifyDay({
    workDate: '2026-08-05',
    before: upload({ id: 'b', capturedAt: '2026-08-05T13:00:00Z', receivedAt: '2026-08-05T13:05:00Z' }),
    after: upload({
      id: 'a',
      phase: 'after',
      contentHash: 'bbb',
      capturedAt: '2026-08-05T20:30:00Z',
      receivedAt: '2026-08-05T20:35:00Z',
    }),
    site: SITE,
  });
  assert.equal(day.complete, true);
  assert.equal(day.contradicted, false);
  assert.match(day.checks.find((c) => c.key === 'ordered')!.detail, /7\.5 hours/);
  assert.equal(day.summary, 'Before and after both check out.');
});

test('a day with only a before says so plainly', () => {
  const day = verifyDay({ workDate: '2026-08-05', before: upload(), after: null, site: SITE });
  assert.equal(day.complete, false);
  assert.equal(day.contradicted, false);
  assert.match(day.summary, /no after video yet/);
});

test('nothing filed is not the same as something wrong', () => {
  const day = verifyDay({ workDate: '2026-08-05', before: null, after: null, site: SITE });
  assert.equal(day.contradicted, false);
  assert.equal(day.summary, 'Nothing filed for this day.');
});

test('unproven and disproven read differently', () => {
  const unproven = verifyDay({
    workDate: '2026-08-05',
    before: upload({ lat: null, lon: null }),
    after: upload({ id: 'a', phase: 'after', contentHash: 'bbb', lat: null, lon: null, capturedAt: '2026-08-05T20:00:00Z', receivedAt: '2026-08-05T20:05:00Z' }),
    site: SITE,
  });
  assert.equal(unproven.contradicted, false);
  assert.equal(unproven.complete, false);
  assert.match(unproven.summary, /Nothing contradicts it/);

  const disproven = verifyDay({
    workDate: '2026-08-05',
    before: upload({ lat: 31.9, lon: -97.1 }),
    after: upload({ id: 'a', phase: 'after', contentHash: 'bbb', capturedAt: '2026-08-05T20:00:00Z', receivedAt: '2026-08-05T20:05:00Z' }),
    site: SITE,
  });
  assert.equal(disproven.contradicted, true);
  assert.match(disproven.summary, /Do not pay against this/);
});

test('payment refuses an incomplete day, a contradicted day, and an unproven one', () => {
  const half = verifyDay({ workDate: '2026-08-05', before: upload(), after: null, site: SITE });
  assert.equal(payable(half).ok, false);
  assert.match(payable(half).because, /both a before and an after/);

  const bad = verifyDay({
    workDate: '2026-08-05',
    before: upload({ lat: 31.9, lon: -97.1 }),
    after: upload({ id: 'a', phase: 'after', contentHash: 'bbb', capturedAt: '2026-08-05T20:00:00Z', receivedAt: '2026-08-05T20:05:00Z' }),
    site: SITE,
  });
  assert.equal(payable(bad).ok, false);
  assert.match(payable(bad).because, /miles from the site/);

  // Unknowns block too. A missing location is not fraud, but paying against a
  // video that could have been filmed anywhere is the outcome being prevented.
  const unproven = verifyDay({
    workDate: '2026-08-05',
    before: upload({ lat: null, lon: null }),
    after: upload({ id: 'a', phase: 'after', contentHash: 'bbb', lat: null, lon: null, capturedAt: '2026-08-05T20:00:00Z', receivedAt: '2026-08-05T20:05:00Z' }),
    site: SITE,
  });
  assert.equal(payable(unproven).ok, false);
  assert.match(payable(unproven).because, /could not be checked/);
});

test('payment clears a day where everything checks out', () => {
  const good = verifyDay({
    workDate: '2026-08-05',
    before: upload({ capturedAt: '2026-08-05T13:00:00Z' }),
    after: upload({
      id: 'a',
      phase: 'after',
      contentHash: 'bbb',
      capturedAt: '2026-08-05T20:00:00Z',
      receivedAt: '2026-08-05T20:05:00Z',
    }),
    site: SITE,
  });
  const verdict = payable(good);
  assert.equal(verdict.ok, true);
  assert.match(verdict.because, /check out on every count/);
});

test('distance is measured on the sphere, not the page', () => {
  assert.ok(milesBetween(SITE, SITE) < 0.001);
  // Round Rock to central Austin is about 17 miles.
  const austin = milesBetween(SITE, { lat: 30.2713, lon: -97.7426 });
  assert.ok(austin > 15 && austin < 20, `got ${austin}`);
});
