import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceLog, filterEvidenceLog, MAX_EVIDENCE_LOG_ENTRIES } from '../src/audio/evidenceLog.js';
import { extractConversationDetails } from '../src/audio/conversationDetails.js';
import { MAX_SPEECH_EVENTS } from '../src/audio/speechEvents.js';
import { MAX_DICTATION_EVENTS } from '../src/shared/dictationEvents.js';

const stamped =
  '[0:18] Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.\n' +
  '[1:36] Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead.\n' +
  '[4:10] Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement.';

test('caps are high enough for a complete evidence log', () => {
  assert.ok(MAX_SPEECH_EVENTS >= 500);
  assert.ok(MAX_DICTATION_EVENTS >= 500);
  assert.ok(MAX_EVIDENCE_LOG_ENTRIES >= 500);
});

test('buildEvidenceLog merges vision, full speech turns, and decisions', () => {
  const conversation = extractConversationDetails(stamped);
  const log = buildEvidenceLog({
    storedEntries: [
      { atSeconds: 8, text: 'Hallway doorway.', type: 'scene' },
      { atSeconds: 48, text: 'Crew at the vanity.', type: 'work' },
    ],
    durationSeconds: 412,
    transcript: stamped,
    conversation,
  });
  assert.ok(log.some((e) => e.type === 'scene'));
  assert.ok(log.some((e) => e.type === 'work'));
  assert.ok(log.filter((e) => e.type === 'said').length >= 2, 'full speech, not a 12-row skim');
  assert.ok(log.some((e) => e.type === 'decision' && /Agreement|Refusal|Promise|Concern/i.test(e.text)));
  assert.deepEqual(
    log.map((e) => e.atSeconds),
    [...log].map((e) => e.atSeconds).sort((a, b) => a - b),
  );
});

test('filterEvidenceLog isolates Said and Decision', () => {
  const conversation = extractConversationDetails(stamped);
  const log = buildEvidenceLog({
    storedEntries: [{ atSeconds: 8, text: 'Hallway doorway.', type: 'scene' }],
    durationSeconds: 412,
    transcript: stamped,
    conversation,
  });
  const said = filterEvidenceLog(log, 'said');
  assert.ok(said.every((e) => e.type === 'said' || e.type === 'speech'));
  assert.ok(said.length >= 2);
  const decisions = filterEvidenceLog(log, 'decision');
  assert.ok(decisions.every((e) => e.type === 'decision'));
  assert.ok(decisions.length >= 1);
});

test('stored evidenceLog is preferred when present', () => {
  const log = buildEvidenceLog({
    storedLog: {
      version: 1,
      entries: [{ atSeconds: 12, text: 'Stored complete row.', type: 'work' }],
    },
    transcript: stamped,
  });
  assert.equal(log.length, 1);
  assert.equal(log[0]?.text, 'Stored complete row.');
});
