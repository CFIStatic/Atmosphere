import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIVACY_REDACTED_LABEL,
  applyPrivacyToEvidenceEntries,
  derivePrivacyRedactions,
  mergePrivacyRanges,
  parsePrivacyRedactions,
  redactTranscriptForAsk,
  secondsInPrivacyRange,
  toStoredPrivacyRedactions,
} from '../src/audio/privacyRedactions.js';

test('parsePrivacyRedactions normalizes model ranges and drops invalid spans', () => {
  const ranges = parsePrivacyRedactions([
    { startSec: 60, endSec: 95, reason: 'bathroom', confidence: 0.9, source: 'vision' },
    { startSec: 10, endSec: 5, reason: 'bad', confidence: 1 },
    { start_sec: 100, end_sec: 120, reason: 'shower', conf: 0.8 },
  ]);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0]!.startSec, 60);
  assert.equal(ranges[1]!.reason, 'shower');
});

test('derivePrivacyRedactions over-redacts bathroom beats from events', () => {
  const ranges = derivePrivacyRedactions({
    durationSeconds: 200,
    events: [
      { atSeconds: 80, text: 'Worker enters the bathroom with the camera still rolling.' },
      { atSeconds: 150, text: 'Back in the hallway installing trim.' },
    ],
  });
  assert.ok(ranges.length >= 1);
  const bath = ranges.find((r) => /bathroom/i.test(r.reason));
  assert.ok(bath);
  assert.ok(bath!.startSec < 80);
  assert.ok(bath!.endSec > 80);
  assert.ok(bath!.confidence >= 0.5);
  assert.ok(secondsInPrivacyRange(82, ranges));
  assert.equal(secondsInPrivacyRange(160, ranges), null);
});

test('mergePrivacyRanges collapses overlapping windows', () => {
  const merged = mergePrivacyRanges([
    { startSec: 10, endSec: 20, reason: 'bathroom', confidence: 0.6, source: 'heuristic' },
    { startSec: 18, endSec: 40, reason: 'toilet area', confidence: 0.8, source: 'vision' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.startSec, 10);
  assert.equal(merged[0]!.endSec, 40);
  assert.equal(merged[0]!.source, 'merged');
  assert.equal(merged[0]!.confidence, 0.8);
});

test('redactTranscriptForAsk replaces speech inside ranges', () => {
  const transcript =
    '[0:10] Crew: Starting in the kitchen.\n' +
    '[1:20] Crew: Hang on, bathroom break.\n' +
    '[2:00] Homeowner: Thanks for coming.';
  const out = redactTranscriptForAsk(transcript, [
    { startSec: 70, endSec: 100, reason: 'bathroom', confidence: 0.7, source: 'heuristic' },
  ]);
  assert.match(String(out), /0:10.*kitchen/i);
  assert.match(String(out), new RegExp(`1:20.*${PRIVACY_REDACTED_LABEL.replace(/[[\]]/g, '\\$&')}`));
  assert.match(String(out), /2:00.*Thanks/i);
});

test('applyPrivacyToEvidenceEntries scrubs said + private scene rows', () => {
  const entries = applyPrivacyToEvidenceEntries(
    [
      { atSeconds: 12, text: 'Opens on kitchen.', type: 'scene' },
      { atSeconds: 80, text: 'Worker: private chat', type: 'said' },
      { atSeconds: 82, text: 'Camera pans across the bathroom vanity.', type: 'scene' },
    ],
    [{ startSec: 70, endSec: 100, reason: 'bathroom', confidence: 0.7, source: 'vision' }],
  );
  assert.equal(entries[0]!.text, 'Opens on kitchen.');
  assert.equal(entries[1]!.text, PRIVACY_REDACTED_LABEL);
  assert.equal(entries[2]!.text, PRIVACY_REDACTED_LABEL);
});

test('toStoredPrivacyRedactions round-trips', () => {
  const stored = toStoredPrivacyRedactions([
    { startSec: 1, endSec: 12, reason: 'shower', confidence: 0.77, source: 'vision' },
  ]);
  assert.ok(stored);
  assert.equal(stored!.version, 1);
  assert.equal(stored!.ranges[0]!.reason, 'shower');
});
