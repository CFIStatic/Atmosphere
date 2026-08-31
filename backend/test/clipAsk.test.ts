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
import { serializeEvidence } from '../src/verifier/library.js';

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

test('a before clip without a reading is still asked about this video', () => {
  const answer = groundedAnswerFromClip('What is happening in this video?', {
    analysisState: 'skipped',
    phase: 'before',
  });
  assert.match(answer, /could not be read/i);
  assert.doesNotMatch(answer, /after video/i);
  assert.doesNotMatch(answer, /has not been read yet/i);
  assert.doesNotMatch(answer, /still being read/i);
});

test('what is happening cites the scene, not a missing after pair', () => {
  const answer = groundedAnswerFromClip('what is happing in this video', {
    analysisState: 'skipped',
    dictation:
      'A person sits at a desk. On the screen is an MSNBC YouTube clip about an Oklahoma state senate race.',
    summary: 'Desk, MSNBC, Oklahoma senate race.',
  });
  assert.match(answer, /MSNBC|senate|desk/i);
  assert.doesNotMatch(answer, /after video/i);
});

test('a comparison question without a reading does not ask for another clip', () => {
  const answer = groundedAnswerFromClip('What changed compared to the after clip?', {
    analysisState: 'skipped',
    phase: 'before',
  });
  assert.match(answer, /could not be read/i);
  assert.doesNotMatch(answer, /after video/i);
  assert.doesNotMatch(answer, /still being read/i);
});

test('an unread clip is being read, not abandoned', () => {
  const answer = groundedAnswerFromClip('What is happening in this video?', {
    analysisState: 'none',
  });
  assert.match(answer, /still being read/i);
  assert.doesNotMatch(answer, /has not been read yet/i);
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

test('answerFromClip skips the model when apiKey is null even if a server key exists', async () => {
  const result = await answerFromClip({
    question: 'Did anything happen?',
    record: cedarAfter,
    apiKey: null,
  });
  assert.equal(result.model, null);
  assert.match(result.answer, /Tarp removed/);
});

test('Ask describes the scene after a late reading lands on an existing clip', () => {
  const unreadProof = {
    id: 'existing-1',
    job_id: 'j1',
    party_id: 'pt1',
    phase: 'before',
    work_date: '2026-08-26',
    captured_at: '2026-08-26T16:00:00Z',
    received_at: '2026-08-26T16:01:00Z',
    duration_seconds: '64',
    byte_size: '1200000',
    lat: null,
    lon: null,
    accuracy_m: null,
    content_hash: 'desk',
    state: 'checked',
    checks: [],
    ai_summary: null,
    ai_findings: {},
    ai_material_change: null,
    ai_model: null,
    analysis_status: null,
    narration_status: 'idle',
    narration_text: null,
    legal_hold: false,
    retention_until: null,
  };
  const named = {
    jobName: 'Desk clip',
    jobNumber: 2001,
    company: 'Field Capture',
    contactName: 'Marcus',
    tier: 1,
    dayHasAfter: false,
  };
  const stale = serializeEvidence({ proof: unreadProof, ...named });
  const staleAnswer = groundedAnswerFromClip(
    'What is happening in this video?',
    clipRecordFromEvidenceItem(stale),
  );
  assert.match(staleAnswer, /still being read/i);
  assert.doesNotMatch(staleAnswer, /has not been read yet/i);

  const fresh = serializeEvidence({
    proof: {
      ...unreadProof,
      narration_status: 'done',
      narration_text:
        'A person sits at a desk. On the screen is an MSNBC YouTube clip about an Oklahoma state senate race.',
      ai_summary: 'Desk, MSNBC, Oklahoma senate race.',
      analysis_status: 'done',
    },
    ...named,
  });
  const answer = groundedAnswerFromClip(
    'What is happening in this video?',
    clipRecordFromEvidenceItem(fresh),
  );
  assert.match(answer, /MSNBC|desk|senate/i);
  assert.doesNotMatch(answer, /has not been read yet|still being read/i);
});
