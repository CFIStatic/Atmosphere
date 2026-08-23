import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFromClip,
  clipRecordFromEvidenceItem,
  formatClipTime,
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

test('did anything happen cites the changes on the clip, with the work date', () => {
  const answer = groundedAnswerFromClip('Did anything happen?', cedarAfter);
  assert.match(answer, /Yes/);
  assert.match(answer, /2026-08-05/);
  assert.match(answer, /Tarp removed/);
  assert.match(answer, /Underlayment/);
});

test('a specific question cites the timestamped beat it was drawn from', () => {
  const answer = groundedAnswerFromClip('Was the tarp removed?', cedarAfter);
  assert.match(answer, /tarp/i);
  assert.match(answer, /0:12/);
});

test('something the camera never showed is refused rather than inferred', () => {
  const answer = groundedAnswerFromClip('Did they replace the water heater?', cedarAfter);
  assert.equal(answer, 'The footage on file does not show that.');
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

/**
 * The bug this pins: every skipped clip used to be told "there is no after
 * video on file for this day". Said to somebody looking at a perfectly good
 * after clip, that is not a hedge — it is the product claiming their footage
 * does not exist. The pipeline records why it stopped; that sentence wins.
 */
test('a skipped clip gives the reason the pipeline recorded, not a guess about pairing', () => {
  const answer = groundedAnswerFromClip('What happened in this clip?', {
    analysisState: 'skipped',
    phase: 'after',
    analysisReason: 'Model access is not configured on this server.',
  });
  assert.match(answer, /model access is not configured/i);
  assert.doesNotMatch(answer, /no after video/i);
});

test('a skipped clip with no recorded reason says that, rather than blaming pairing', () => {
  const answer = groundedAnswerFromClip('What happened in this clip?', {
    analysisState: 'skipped',
    phase: 'after',
  });
  assert.doesNotMatch(answer, /no after video/i);
  assert.match(answer, /has not read this clip/);
});

test('a failed reading keeps the footage above suspicion', () => {
  const answer = groundedAnswerFromClip('What happened?', {
    analysisState: 'failed',
    phase: 'after',
    analysisReason: 'The model reply was not usable.',
  });
  assert.match(answer, /model reply was not usable/i);
  assert.match(answer, /footage itself is unaffected/);
});

test('the reason survives the trip from the serialized list item', () => {
  const record = clipRecordFromEvidenceItem({
    workDate: '2026-08-22',
    phase: 'after',
    analysisState: 'skipped',
    analysisReason: 'No frames could be read out of the day film.',
    analysis: null,
  });
  assert.equal(record.analysisReason, 'No frames could be read out of the day film.');
  assert.match(
    groundedAnswerFromClip('what happened in this clip', record),
    /no frames could be read/i,
  );
});

/**
 * A clip with no reading still carries a work date and a crew name — enough
 * for a model to write a confident paragraph about footage nobody looked at.
 * The unread sentence is the honest answer, so the model is never asked.
 */
test('an unread clip is answered without a model round trip', async () => {
  const result = await answerFromClip({
    question: 'What work is visible?',
    record: {
      workDate: '2026-08-22',
      phase: 'after',
      company: 'Brightline Electric',
      durationSeconds: 2,
      analysisState: 'skipped',
      analysisReason: 'No frames could be read out of the day film.',
    },
  });
  assert.equal(result.model, null);
  assert.match(result.answer, /no frames could be read/i);
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

test('answerFromClip falls back to the grounded reading when no model is configured', async () => {
  const result = await answerFromClip({ question: 'Did anything happen?', record: cedarAfter });
  assert.equal(result.model, null);
  assert.match(result.answer, /Tarp removed/);
});
