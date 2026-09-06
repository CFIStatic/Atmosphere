import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConversationDetails, hasConversation } from '../src/audio/conversationDetails.js';
import { speechEventsFromTranscript, transcriptSegments } from '../src/audio/speechEvents.js';
import { resolveDictationEntries } from '../src/shared/dictationEvents.js';

const talk =
  '[0:18] Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.\n' +
  '[1:36] Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead.\n' +
  '[4:10] Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement.';

test('hasConversation is false for empty, skipped, and noise-only mics', () => {
  assert.equal(hasConversation(extractConversationDetails('')), false);
  assert.equal(hasConversation(extractConversationDetails('   ')), false);
  assert.equal(hasConversation(extractConversationDetails('okay. yeah. mm hmm. thanks.')), false);
});

test('speechEventsFromTranscript emits SAID rows at real transcript clocks', () => {
  const events = speechEventsFromTranscript(talk, { durationSeconds: 412 });
  assert.ok(events.length >= 2);
  assert.ok(events.every((event) => event.type === 'said'));
  assert.deepEqual(
    events.map((event) => event.atSeconds).sort((a, b) => a - b),
    events.map((event) => event.atSeconds),
  );
  assert.ok(events.some((event) => event.atSeconds === 18 && /insurance|cabinets|vanity/i.test(event.text)));
  assert.ok(events.some((event) => event.atSeconds === 96 && /mirror|go ahead/i.test(event.text)));
  assert.ok(events.some((event) => event.atSeconds === 250 && /hallway|agreement/i.test(event.text)));
  assert.ok(!events.some((event) => event.atSeconds === 0 && event.text.length > 180));
});

test('speechEventsFromTranscript is empty when nobody is conversing', () => {
  assert.deepEqual(speechEventsFromTranscript(null), []);
  assert.deepEqual(speechEventsFromTranscript(''), []);
  assert.deepEqual(speechEventsFromTranscript('   \n  '), []);
  assert.deepEqual(
    speechEventsFromTranscript('Wind and a blinker. Tool noise on the dash.', { durationSeconds: 90 }),
    [],
  );
});

test('a 10-minute Whisper dump stamped [0:00] is not a junk 0:00 SAID blob', () => {
  const dump =
    '[0:00] ' +
    'The crew is walking the north slope with the camera rolling, naming vents and flashing, ' +
    'and talking over the wind about underlayment rows and bagged debris at the driveway. '.repeat(8) +
    'Homeowner: I do not want you to replace the cabinets unless insurance approves it. ' +
    'That was the agreement on the claim.';
  const events = speechEventsFromTranscript(dump, { durationSeconds: 600 });
  assert.ok(events.length >= 1);
  assert.ok(events.every((event) => event.type === 'said'));
  assert.ok(events.every((event) => event.text.length <= 240));
  assert.ok(
    events.some((event) => /insurance|cabinets|agreement/i.test(event.text) && event.atSeconds > 1),
    'substance buried in a [0:00] dump must seek into the chunk, not sit at 0:00',
  );
  assert.ok(!events.some((event) => event.atSeconds === 0 && event.text.length > 180));
});

test('a [0:00] Whisper dump with no duration is omitted, not pinned to 0:00', () => {
  const dump =
    '[0:00] ' +
    'The crew is walking the north slope with the camera rolling, naming vents and flashing, ' +
    'and talking over the wind about underlayment rows and bagged debris at the driveway. '.repeat(8) +
    'Homeowner: I do not want you to replace the cabinets unless insurance approves it. ' +
    'That was the agreement on the claim.';
  assert.deepEqual(speechEventsFromTranscript(dump), []);
  assert.deepEqual(speechEventsFromTranscript(dump, { durationSeconds: null }), []);
  const resolved = resolveDictationEntries({
    transcript: dump,
    summary: 'Walkthrough on the north slope.',
  });
  assert.equal(resolved.filter((event) => event.type === 'said').length, 0);
});

test('unstamped talk with a known duration still gets seek times, not one 0:00 blob', () => {
  const unstamped =
    'Homeowner: The leak started behind the vanity in the bathroom. ' +
    'I do not want you to replace the cabinets unless insurance approves it. ' +
    'Please do not cut the hallway any higher than two feet.';
  const events = speechEventsFromTranscript(unstamped, { durationSeconds: 412 });
  assert.ok(events.length >= 2);
  assert.ok(events.every((event) => event.type === 'said'));
  assert.ok(events.every((event) => Number.isFinite(event.atSeconds) && event.atSeconds >= 0));
  const later = events.filter((event) => event.atSeconds > 0);
  assert.ok(later.length >= 1, 'later sentences must not all collapse to 0:00');
  assert.ok(!events.some((event) => event.atSeconds === 0 && event.text === unstamped));
});

test('transcriptSegments reads [m:ss] chunks and leaves unstamped text as one bag', () => {
  const stamped = transcriptSegments(talk);
  assert.equal(stamped.length, 3);
  assert.equal(stamped[0]!.at, 18);
  assert.equal(stamped[1]!.at, 96);
  assert.equal(stamped[2]!.at, 250);
  const bare = transcriptSegments('Homeowner asked about the leak.');
  assert.equal(bare.length, 1);
  assert.equal(bare[0]!.at, null);
});

test('resolveDictationEntries interleaves SAID with vision and skips silent mics', () => {
  const mixed = resolveDictationEntries({
    stored: [
      { atSeconds: 8, text: 'Hallway in frame.', type: 'scene' },
      { atSeconds: 120, text: 'Bathroom doorway.', type: 'camera' },
    ],
    transcript: talk,
    durationSeconds: 412,
    summary: 'Walkthrough with the homeowner.',
  });
  const types = mixed.map((event) => event.type);
  assert.ok(types.includes('scene'));
  assert.ok(types.includes('said'));
  const times = mixed.map((event) => event.atSeconds);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(mixed.some((event) => event.type === 'said' && event.atSeconds === 18));

  const silent = resolveDictationEntries({
    stored: [
      { atSeconds: 8, text: 'Two monitors come into view.', type: 'scene' },
      { atSeconds: 18, text: 'A spreadsheet is readable.', type: 'activity' },
    ],
    transcript: null,
    durationSeconds: 24,
    summary: 'An office desk with two monitors.',
  });
  assert.equal(silent.filter((event) => event.type === 'said').length, 0);
  assert.deepEqual(
    silent.map((event) => event.atSeconds),
    [8, 18],
  );
});
