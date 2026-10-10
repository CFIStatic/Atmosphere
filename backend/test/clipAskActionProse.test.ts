import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionProse,
  groundedAnswerFromClip,
  isChoiceQuestion,
  type ClipAskRecord,
} from '../src/shared/clipAsk.js';

const laptopClip: ClipAskRecord = {
  transcript: '[0:02] So the hackers got into the network through an old router.',
  actions: [
    {
      atSeconds: 1,
      room: 'living_room',
      action: 'other',
      description: 'living_room: Watching a YouTube podcast broadcast playing on a laptop screen.',
      objectLabel: 'laptop',
      objects: ['laptop screen'],
    },
  ],
};

test('actionProse writes a sentence, not a field dump', () => {
  const line = actionProse(laptopClip.actions![0]!);
  assert.equal(line, 'Watching a YouTube podcast broadcast playing on a laptop screen in the living room');
  assert.equal(actionProse({ action: 'remove_drywall', room: 'kitchen' }), 'Remove drywall in the kitchen');
  assert.equal(actionProse({ action: 'other', room: 'other' }), '');
});

test('"A or B?" is a choice question, not yes/no', () => {
  assert.equal(isChoiceQuestion('Is the discussion coming from people in the room or from media on the laptop?'), true);
  assert.equal(isChoiceQuestion('Did they finish the kitchen or not?'), false);
  assert.equal(isChoiceQuestion('Did they finish the kitchen?'), false);
});

test('progress-page Ask answers the laptop question in plain prose (regression)', () => {
  const answer = groundedAnswerFromClip(
    'Is the discussion of hacking coming from people physically in the room or from media playing on the laptop? What visual evidence supports your answer?',
    laptopClip,
  );
  assert.doesNotMatch(answer, /living_room|—\s*other\s*—|—\s*laptop/);
  assert.doesNotMatch(answer, /^Yes\./);
  assert.match(answer, /^It looks like it's coming from media playing on the laptop/);
  assert.match(answer, /YouTube podcast broadcast playing on a laptop screen in the living room/);
  assert.match(answer, /0:01/);
  // Only what the reading says: no invented absence or speaker claims.
  assert.doesNotMatch(answer, /\b(nobody|no one|no people|not speaking|isn't speaking|is not speaking|no one is)\b/i);
  assert.doesNotMatch(answer, /physically in the room/i);
});

test('a choice question with no supporting reading row is not answered by the choice path', () => {
  const answer = groundedAnswerFromClip('Is the tarp blue or green?', { actions: [{ atSeconds: 4, description: 'Crew carries shingles up a ladder.' }] });
  assert.doesNotMatch(answer, /It looks like it's/);
});
