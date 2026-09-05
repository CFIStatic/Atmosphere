import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsFromActions,
  parseDictationEvents,
  parseTimestampedNarration,
  resolveDictationEntries,
} from '../src/shared/dictationEvents.js';

test('parseDictationEvents accepts t_seconds / description and snaps to frames', () => {
  const events = parseDictationEvents(
    [
      { t_seconds: 7.4, description: 'Camera pans to the two monitors.', type: 'camera' },
      { atSeconds: 18, text: 'Spreadsheet readable on the right screen.', type: 'activity' },
      { note: 'missing time is dropped' },
    ],
    { frames: [0, 8, 18] },
  );
  assert.equal(events.length, 2);
  assert.equal(events[0]!.atSeconds, 8);
  assert.equal(events[0]!.type, 'camera');
  assert.match(events[0]!.text, /monitors/);
  assert.equal(events[1]!.atSeconds, 18);
});

test('parseTimestampedNarration splits event-boundary prose, not a cadence', () => {
  const events = parseTimestampedNarration(
    'At 0 seconds, ceiling lights and a vent. At 8 seconds, two monitors and a webcam. At 18 seconds, a spreadsheet is in frame.',
  );
  assert.deepEqual(
    events.map((e) => e.atSeconds),
    [0, 8, 18],
  );
  assert.match(events[1]!.text, /monitors/);
  assert.equal(parseTimestampedNarration('The crew pulls wet drywall along the south wall.').length, 0);
  const one = parseTimestampedNarration(
    'At 0 seconds, the camera captures fluorescent lights, two monitors, and a spreadsheet in one long look.',
  );
  assert.equal(one.length, 1);
  assert.equal(one[0]!.atSeconds, 0);
});

test('parseTimestampedNarration reads [m:ss] beats', () => {
  const events = parseTimestampedNarration('[0:05] Tarp unclipped.\n[0:12] Decking exposed.');
  assert.equal(events.length, 2);
  assert.equal(events[0]!.atSeconds, 5);
  assert.equal(events[1]!.atSeconds, 12);
});

test('resolveDictationEntries prefers stored rows, then prose, then actions', () => {
  const stored = resolveDictationEntries({
    stored: [{ atSeconds: 12, text: 'Tarp gone.' }],
    narrationText: 'At 0 seconds, ignore this blob.',
    actions: [{ atSeconds: 0, description: 'Watching a desk.', action: 'watch' }],
  });
  assert.equal(stored[0]!.text, 'Tarp gone.');

  const fromText = resolveDictationEntries({
    stored: [],
    narrationText: 'At 0 seconds, ceiling. At 8 seconds, monitors.',
  });
  assert.equal(fromText.length, 2);

  const fromActions = resolveDictationEntries({
    stored: [],
    narrationText: 'A person sits at a desk watching a news clip.',
    actions: [
      { atSeconds: 0, description: 'Ceiling and vent.', action: 'watch' },
      { atSeconds: 8, description: 'Two monitors on the desk.', action: 'watch' },
    ],
  });
  assert.equal(fromActions.length, 2);
  assert.equal(fromActions[0]!.type, 'scene');
});

test('eventsFromActions keeps watch rows (office clips are mostly watch)', () => {
  const events = eventsFromActions([
    { atSeconds: 0, description: 'Viewing an office desk setup.', action: 'watch' },
    { atSeconds: 14, description: 'Pulling wet drywall.', action: 'remove' },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0]!.type, 'scene');
  assert.equal(events[1]!.type, 'work');
});
