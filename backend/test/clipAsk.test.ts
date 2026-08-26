import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFromClip,
  clipRecordFromEvidenceItem,
  formatClipTime,
  formatClipTimeSpoken,
  groundedAnswerFromClip,
  type ClipAskRecord,
} from '../src/shared/clipAsk.js';

const cedarAfter: ClipAskRecord = {
  workDate: '2026-08-05',
  phase: 'after',
  company: 'Delgado Roofing',
  durationSeconds: 143,
  analysisState: 'done',
  dictation:
    'Looking at the after clip against the morning before: the temporary tarp is gone from the north slope, the decking is bare and dry, and new underlayment covers roughly two thirds of what was filmed. Debris is bagged at the driveway. The camera never gets close enough to judge sheathing replacement or the ridge.',
  summary: 'The north slope is stripped to decking and the temporary tarp has been removed.',
  changes: [
    'Tarp removed from the north slope',
    'Decking exposed, no visible sheathing damage',
    'Underlayment laid across approximately two thirds of the slope',
  ],
  actions: [
    { atSeconds: 12, action: 'remove', description: 'Temporary tarp pulled off the north slope; decking exposed.' },
    { atSeconds: 48, action: 'position', description: 'Synthetic underlayment being laid across mid-slope.' },
  ],
  dictationEntries: [
    { atSeconds: 12, text: 'Opens on the north slope — tarp gone, deck exposed.' },
    { atSeconds: 48, text: 'Underlayment rows visible mid-slope; debris staged below.' },
    { atSeconds: 110, text: 'Driveway bags and ladder; no close pass on the ridge.' },
  ],
  scope: [
    { title: 'Remove temporary tarp', verdict: 'appears_complete' },
    { title: 'DO NOT touch the skylights', verdict: 'not_visible', because: 'Passed in four windows, worked in none.' },
  ],
  couldNotTell: ['Whether any decking was replaced — no close footage of the sheathing.'],
};

test('formatClipTime: minutes for short clips, hours for a workday', () => {
  assert.equal(formatClipTime(12), '0:12');
  assert.equal(formatClipTime(110), '1:50');
  assert.equal(formatClipTime(4620), '1:17:00');
  assert.equal(formatClipTime(null), null);
});

test('formatClipTimeSpoken says the clock the way a person would', () => {
  assert.equal(formatClipTimeSpoken(12), '12 seconds into the recording');
  assert.equal(formatClipTimeSpoken(6720), '1 hour and 52 minutes into the recording');
  assert.equal(formatClipTimeSpoken(null), null);
});

test('did anything happen cites the changes on the clip, with the work date', () => {
  const answer = groundedAnswerFromClip('Did anything happen?', cedarAfter);
  assert.match(answer, /Yes/);
  assert.match(answer, /2026-08-05/);
  assert.match(answer, /Tarp removed/);
  assert.match(answer, /Underlayment/);
});

test('a specific question cites the timestamped beat it was drawn from', () => {
  const answer = groundedAnswerFromClip('Was the tarp removed?', cedarAfter);
  assert.match(answer, /^Yes\./);
  assert.match(answer, /tarp/i);
  assert.match(answer, /12 seconds into the recording/);
});

test('something the camera never showed is refused rather than inferred', () => {
  const answer = groundedAnswerFromClip('Did they replace the water heater?', cedarAfter);
  assert.equal(answer, 'No. The footage on file does not show that.');
});

test('a room question does not match a different room that only shares the word room', () => {
  const answer = groundedAnswerFromClip('At any point did the worker go in the bathroom?', {
    analysisState: 'done',
    dictationEntries: [
      { atSeconds: 180, text: 'Living room extraction; air movers on the wet carpet.' },
    ],
  });
  assert.equal(answer, 'No. The footage on file does not show that.');
});

test('a work question in a room that was only walked through answers no', () => {
  const answer = groundedAnswerFromClip('Did they work in the kitchen?', {
    analysisState: 'done',
    dictationEntries: [
      { atSeconds: 9000, text: 'Kitchen walked through; no work visible on the cabinets or floor.' },
    ],
  });
  assert.match(answer, /^No\./);
  assert.match(answer, /no work visible/i);
  assert.match(answer, /2 hours and 30 minutes into the recording/);
});

test('a bathroom question answers yes with what was seen and when', () => {
  const workday: ClipAskRecord = {
    analysisState: 'done',
    durationSeconds: 10800,
    dictation: 'The crew works the living room all morning, then enters the bathroom to remount the mirror.',
    actions: [
      {
        atSeconds: 6720,
        action: 'position',
        room: 'bathroom',
        description: 'They went in the bathroom to remount the mirror.',
        object: 'mirror',
      },
    ],
    dictationEntries: [
      { atSeconds: 6720, text: 'They went in the bathroom to remount the mirror.' },
    ],
  };
  const answer = groundedAnswerFromClip('At any point did the worker go in the bathroom?', workday);
  assert.match(answer, /^Yes\./);
  assert.match(answer, /bathroom/i);
  assert.match(answer, /mirror/i);
  assert.match(answer, /1 hour and 52 minutes into the recording/);
});

test('a question about skylights cites the scope reading rather than inventing contact', () => {
  const answer = groundedAnswerFromClip('Did they touch the skylights?', cedarAfter);
  assert.match(answer, /skylight/i);
  assert.doesNotMatch(answer, /does not show that/);
});

test('a before clip without a reading points at the after', () => {
  const answer = groundedAnswerFromClip('Did anything happen?', {
    analysisState: 'paired',
    phase: 'before',
  });
  assert.match(answer, /after clip/);
});

test('a clip still being read says so instead of inventing work', () => {
  const answer = groundedAnswerFromClip('Did anything happen?', { analysisState: 'queued' });
  assert.match(answer, /still being read/);
});

test('clipRecordFromEvidenceItem copies the office reading, not the list chrome', () => {
  const record = clipRecordFromEvidenceItem({
    workDate: '2026-08-05',
    phase: 'after',
    company: 'Delgado Roofing',
    durationSeconds: 143,
    analysisState: 'done',
    analysis: {
      dictation: 'Tarp is gone.',
      summary: 'North slope stripped.',
      changes: ['Tarp removed'],
      dictationEntries: [{ atSeconds: 12, text: 'Tarp gone.' }],
    },
  });
  assert.equal(record.dictation, 'Tarp is gone.');
  assert.equal(record.changes?.[0], 'Tarp removed');
  assert.equal(record.dictationEntries?.[0]?.text, 'Tarp gone.');
});

test('a homeowner conversation is answered from the mic, not the frames', () => {
  const talk = {
    analysisState: 'done' as const,
    transcript:
      '[0:18] Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.\n' +
      '[1:36] Contractor: We will remount the mirror today and leave the cabinets until the adjuster says go ahead.',
    conversationDetails: [
      'Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.',
      'Contractor: We will remount the mirror today and leave the cabinets until the adjuster says go ahead.',
    ],
    conversationAgreements: [
      'We will remount the mirror today and leave the cabinets until the adjuster says go ahead.',
    ],
    conversationRooms: ['bathroom'],
  };
  const answer = groundedAnswerFromClip('What did the homeowner say?', talk);
  assert.match(answer, /^Yes/);
  assert.match(answer, /vanity/i);
  assert.match(answer, /insurance/i);

  const insurance = groundedAnswerFromClip('Did the homeowner mention insurance?', talk);
  assert.match(insurance, /^Yes/);
  assert.match(insurance, /insurance/i);

  const agreed = groundedAnswerFromClip('What did they agree to?', talk);
  assert.match(agreed, /mirror|cabinets|adjuster/i);
});

test('answerFromClip falls back to the grounded reading when no model is configured', async () => {
  const result = await answerFromClip({ question: 'Did anything happen?', record: cedarAfter });
  assert.equal(result.model, null);
  assert.match(result.answer, /Tarp removed/);
});
