import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionProse,
  groundedAnswerFromClip,
  isChoiceQuestion,
  type ClipAskRecord,
} from '../src/shared/clipAsk.js';

const laptopClip: ClipAskRecord = {
  summary: 'A handheld clip inside a home. The hacking discussion is coming from media playing on a laptop; visual check shows nobody physically in the room is speaking.',
  actions: [
    {
      atSeconds: 1,
      room: 'living_room',
      action: 'other',
      description: 'living_room: Watching a YouTube podcast broadcast playing on a laptop screen.',
      objectLabel: 'laptop',
      objects: ['laptop screen'],
    } as any,
  ],
} as any;

test('actionProse writes a sentence, not a field dump', () => {
  const line = actionProse(laptopClip.actions![0] as any);
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
  assert.match(answer, /laptop screen/);
  assert.match(answer, /1 second into the recording/);
});
