import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHILD_PRIVACY_CATEGORY,
  CHILD_PRIVACY_REDACTED_LABEL,
  MIN_CHILD_PRIVACY_CONFIDENCE,
  applyChildPrivacyToEvidenceEntries,
  childRangeMutesAudio,
  deriveChildPrivacyRedactions,
  normalizeAgeAppearance,
  parseChildPrivacyRedactions,
  redactTranscriptForChildPrivacy,
  secondsInChildPrivacyRange,
  toStoredChildPrivacyRedactions,
} from '../src/audio/childPrivacyRedactions.js';

test('normalizeAgeAppearance maps child/adult/cannotTell only', () => {
  assert.equal(normalizeAgeAppearance('child'), 'child');
  assert.equal(normalizeAgeAppearance('Toddler'), 'child');
  assert.equal(normalizeAgeAppearance('adult'), 'adult');
  assert.equal(normalizeAgeAppearance('cannotTell'), 'cannotTell');
  assert.equal(normalizeAgeAppearance('maybe'), null);
});

test('parseChildPrivacyRedactions drops cannotTell, adult, and low confidence', () => {
  const ranges = parseChildPrivacyRedactions([
    { startSec: 10, endSec: 40, reason: 'child', confidence: 0.9, source: 'vision' },
    { startSec: 50, endSec: 80, reason: 'unclear', confidence: 0.9, ageAppearance: 'cannotTell' },
    { startSec: 90, endSec: 120, reason: 'adult', confidence: 0.9, ageAppearance: 'adult' },
    { startSec: 130, endSec: 160, reason: 'kid', confidence: 0.2, source: 'vision' },
  ]);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0]!.startSec, 10);
  assert.ok(ranges[0]!.confidence >= MIN_CHILD_PRIVACY_CONFIDENCE);
  assert.equal(ranges[0]!.category, CHILD_PRIVACY_CATEGORY);
});

test('deriveChildPrivacyRedactions pads child beats from events', () => {
  const ranges = deriveChildPrivacyRedactions({
    durationSeconds: 200,
    events: [
      { atSeconds: 80, text: 'A child walks into the living room.' },
      { atSeconds: 150, text: 'Crew installs trim in the hallway.' },
    ],
  });
  assert.ok(ranges.length >= 1);
  const hit = ranges.find((r) => /child/i.test(r.reason));
  assert.ok(hit);
  assert.ok(secondsInChildPrivacyRange(82, ranges));
  assert.equal(secondsInChildPrivacyRange(160, ranges), null);
});

test('derive always runs — child privacy blur is mandatory', () => {
  const ranges = deriveChildPrivacyRedactions({
    events: [{ atSeconds: 10, text: 'A toddler is visible.' }],
    visionRanges: [
      { startSec: 5, endSec: 20, reason: 'child present', confidence: 0.9, source: 'vision' },
    ],
  });
  assert.ok(ranges.length >= 1);
  assert.ok(secondsInChildPrivacyRange(10, ranges));
});

test('derive uses people ageAppearance=child and skips cannotTell', () => {
  const ranges = deriveChildPrivacyRedactions({
    durationSeconds: 100,
    peopleNotes: [
      { tSec: 30, note: 'stands near sofa', ageAppearance: 'child' },
      { tSec: 60, note: 'maybe young', ageAppearance: 'cannotTell' },
    ],
  });
  assert.ok(ranges.length >= 1);
  assert.ok(secondsInChildPrivacyRange(32, ranges));
  assert.equal(secondsInChildPrivacyRange(62, ranges), null);
});

test('redactTranscriptForChildPrivacy replaces speech inside ranges', () => {
  const transcript =
    '[0:10] Crew: Starting in the kitchen.\n' +
    '[1:20] Crew: Watch the kid.\n' +
    '[2:00] Homeowner: Thanks.';
  const out = redactTranscriptForChildPrivacy(transcript, [
    { startSec: 70, endSec: 100, reason: 'child present', confidence: 0.7, source: 'heuristic' },
  ]);
  assert.match(String(out), /0:10.*kitchen/i);
  assert.match(String(out), new RegExp(`1:20.*${CHILD_PRIVACY_REDACTED_LABEL.replace(/[[\]]/g, '\\$&')}`));
  assert.match(String(out), /2:00.*Thanks/i);
});

test('applyChildPrivacyToEvidenceEntries scrubs child scenes', () => {
  const entries = applyChildPrivacyToEvidenceEntries(
    [
      { atSeconds: 12, text: 'Opens on kitchen.', type: 'scene' },
      { atSeconds: 80, text: 'Child near the stairs.', type: 'scene' },
      { atSeconds: 82, text: 'Worker: hey kid', type: 'said' },
    ],
    [{ startSec: 70, endSec: 100, reason: 'child present', confidence: 0.7, source: 'vision' }],
  );
  assert.equal(entries[0]!.text, 'Opens on kitchen.');
  assert.equal(entries[1]!.text, CHILD_PRIVACY_REDACTED_LABEL);
  assert.equal(entries[2]!.text, CHILD_PRIVACY_REDACTED_LABEL);
});

test('childRangeMutesAudio only when no region boxes', () => {
  assert.equal(
    childRangeMutesAudio({
      startSec: 1,
      endSec: 10,
      reason: 'child present',
      confidence: 0.8,
      source: 'vision',
    }),
    true,
  );
  assert.equal(
    childRangeMutesAudio({
      startSec: 1,
      endSec: 10,
      reason: 'child present',
      confidence: 0.8,
      source: 'vision',
      regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.3 }],
    }),
    false,
  );
});

test('toStoredChildPrivacyRedactions round-trips', () => {
  const stored = toStoredChildPrivacyRedactions([
    { startSec: 1, endSec: 12, reason: 'child present', confidence: 0.77, source: 'vision' },
  ]);
  assert.ok(stored);
  assert.equal(stored!.version, 1);
  assert.equal(stored!.category, CHILD_PRIVACY_CATEGORY);
  assert.equal(stored!.ranges[0]!.reason, 'child present');
});

test('a full-frame child range merged with a boxed one stays full-frame (and mutes)', () => {
  const [range] = parseChildPrivacyRedactions([
    { startSec: 10, endSec: 20, confidence: 0.9, reason: 'child present' },
    { startSec: 20.5, endSec: 24, confidence: 0.9, reason: 'child present', regions: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] },
  ]);
  assert.equal(range.startSec, 10);
  assert.equal(range.endSec, 24);
  assert.equal(range.regions, undefined);
  assert.equal(childRangeMutesAudio(range), true);
});

test('a boxed range longer than 10s blurs the whole frame', () => {
  const [short] = parseChildPrivacyRedactions([
    { startSec: 0, endSec: 8, confidence: 0.9, reason: 'child', regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
  ]);
  assert.equal(short.regions?.length, 1);
  const [long] = parseChildPrivacyRedactions([
    { startSec: 0, endSec: 25, confidence: 0.9, reason: 'child', regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
  ]);
  assert.equal(long.regions, undefined);
});

test('everyday words for a child are caught; "minor damage" is not a child', () => {
  for (const text of [
    'a young girl walks through the kitchen',
    'small boy watching from the hallway',
    'homeowner and her daughter by the door',
    'his son carries a toy',
    'little ones playing in the yard',
  ]) {
    const ranges = deriveChildPrivacyRedactions({ durationSeconds: 60, events: [{ atSeconds: 5, text }] });
    assert.equal(ranges.length, 1, text);
  }
  for (const text of ['minor damage to the drywall', 'baby monitor on the shelf', 'child lock on cabinet']) {
    assert.deepEqual(deriveChildPrivacyRedactions({ durationSeconds: 60, events: [{ atSeconds: 5, text }] }), [], text);
  }
});

test('a person note that names a child counts even when the age read is unclear or adult', () => {
  const ranges = deriveChildPrivacyRedactions({
    durationSeconds: 60,
    peopleNotes: [
      { tSec: 5, note: 'kid by the door', ageAppearance: 'cannotTell' },
      { tSec: 40, note: 'parent carrying a baby', ageAppearance: 'adult' },
      { tSec: 50, note: 'electrician on ladder', ageAppearance: 'adult' },
    ],
  });
  assert.deepEqual(
    ranges.map((r) => [r.startSec, r.endSec]),
    [
      [3, 33],
      [38, 60],
    ],
  );
});

test('vision ranges are padded and their boxes widened', () => {
  const [range] = deriveChildPrivacyRedactions({
    durationSeconds: 60,
    visionRanges: [
      { startSec: 10, endSec: 14, reason: 'child present', confidence: 0.9, source: 'vision', regions: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] },
    ],
  });
  assert.equal(range.startSec, 8);
  assert.equal(range.endSec, 17);
  assert.deepEqual(
    range.regions?.map((r) => [r.x, r.y, r.w, r.h]),
    [[0.3, 0.3, 0.4, 0.4]],
  );
});
