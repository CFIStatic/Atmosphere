import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNarration,
  parseObservation,
  stepsForNarration,
  type StageStep,
} from '../src/shared/liveNarrator.js';

/**
 * The narrator's parsers. What earns a test is anything that could let a
 * confident fabrication into a report that gets read as a record: an invented
 * stage, a note about a frame that does not exist, coverage the model claimed
 * rather than earned.
 */

const STEPS: StageStep[] = [
  { kind: 'anchor', label: 'Start outside, facing the front of the building' },
  { kind: 'scope', label: 'Walk the area for "Strip north slope to decking"' },
  { kind: 'exclusion', label: 'Pass the excluded area — "Touch the skylights"' },
  { kind: 'wrap', label: 'Finish on anything unexpected you found' },
];

const FRAMES = [{ atSeconds: 5 }, { atSeconds: 42 }, { atSeconds: 78 }, { atSeconds: 110 }];

/* ---- live observation ---- */

test('a live observation parses, with the stage clamped to the list', () => {
  const good = parseObservation('{"stage": 1, "note": "Bare decking, mid slope.", "confidence": 0.7}', STEPS.length);
  assert.deepEqual(good, { stageIndex: 1, note: 'Bare decking, mid slope.', confidence: 0.7 });

  // A stage the list does not have is not a stage — unclear, not invention.
  const invented = parseObservation('{"stage": 9, "note": "Something.", "confidence": 0.9}', STEPS.length);
  assert.equal(invented?.stageIndex, -1);

  const negative = parseObservation('{"stage": -5, "note": "Something.", "confidence": 0.2}', STEPS.length);
  assert.equal(negative?.stageIndex, -1);
});

test('confidence is clamped and garbage is refused whole', () => {
  const clamped = parseObservation('{"stage": 0, "note": "Front of the house.", "confidence": 7}', STEPS.length);
  assert.equal(clamped?.confidence, 1);
  assert.equal(parseObservation('the crew is on step two', STEPS.length), null);
  assert.equal(parseObservation('{"stage": 1, "confidence": 0.5}', STEPS.length), null, 'no note, no observation');
});

/* ---- narration ---- */

test('a grounded narration parses, and coverage is computed rather than trusted', () => {
  const parsed = parseNarration(
    JSON.stringify({
      entries: [
        { frame: 0, stage: 0, note: 'Opens at the front elevation, house number visible.' },
        { frame: 1, stage: 1, note: 'North slope stripped to decking.' },
        { frame: 3, stage: -1, note: 'Close on a shingle bundle; location unclear.' },
      ],
      report: 'The clip opens at the street, walks the stripped north slope, and ends on staged materials.',
    }),
    FRAMES,
    STEPS,
  );
  assert.ok(parsed);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].atSeconds, 5, 'entry timing comes from the real frame, not the model');
  // Steps 0 and 1 were seen; the exclusion and the wrap were not — whatever
  // the model might have claimed.
  assert.deepEqual(
    parsed.coverage.map((c) => c.seen),
    [true, true, false, false],
  );
  assert.ok(parsed.actions.some((a) => a.action === 'remove'));
});

test('entries pointing at frames that do not exist are dropped, and an ungrounded report is refused', () => {
  const oneGood = parseNarration(
    JSON.stringify({
      entries: [
        { frame: 17, stage: 0, note: 'A frame nobody sent.' },
        { frame: 2, stage: 3, note: 'A meter reading held to the lens.' },
      ],
      report: 'Ends on a documented reading.',
    }),
    FRAMES,
    STEPS,
  );
  assert.ok(oneGood);
  assert.equal(oneGood.entries.length, 1);
  assert.equal(oneGood.entries[0].frame, 2);

  // All entries invalid -> a report with no grounding at all -> null, because
  // prose with nothing under it reads as a record and is not one.
  const none = parseNarration(
    JSON.stringify({
      entries: [{ frame: 99, stage: 0, note: 'Invented.' }],
      report: 'A thorough walkthrough of all areas.',
    }),
    FRAMES,
    STEPS,
  );
  assert.equal(none, null);
});

test('an invented stage inside an entry degrades to unclear, not to a new stage', () => {
  const parsed = parseNarration(
    JSON.stringify({
      entries: [{ frame: 0, stage: 12, note: 'Opens somewhere.' }],
      report: 'Opens somewhere it should not.',
    }),
    FRAMES,
    STEPS,
  );
  assert.equal(parsed?.entries[0].stageIndex, -1);
});

test('stepsForNarration keeps the first sentence and the kind', () => {
  const steps = stepsForNarration([
    {
      kind: 'anchor',
      instruction:
        'Start outside, facing the front of the building. Hold steady for a few seconds — get the house number.',
    },
    { kind: 'wrap', instruction: 'Finish on any meter or reading in use — numbers on camera count.' },
  ]);
  assert.equal(steps[0].label, 'Start outside, facing the front of the building');
  assert.equal(steps[0].kind, 'anchor');
  assert.equal(steps[1].kind, 'wrap');
});
