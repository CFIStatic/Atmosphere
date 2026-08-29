import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimestampedTranscript,
  parseTranscriptClock,
  splitTranscriptUtterances,
  stampClock,
} from '../src/audio/transcriptFormat.js';
import { transcriptFromProviderBody } from '../src/lib/transcription.js';
import { extractConversationDetails, mergeConversationFindings } from '../src/audio/conversationDetails.js';
import { transcriptPersistPatch } from '../src/audio/proofTranscript.js';

test('stampClock matches the side-log clocks the verifier already parses', () => {
  assert.equal(stampClock(12), '0:12');
  assert.equal(stampClock(96), '1:36');
  assert.equal(stampClock(3723), '1:02:03');
  assert.equal(parseTranscriptClock('0:18'), 18);
  assert.equal(parseTranscriptClock('1:02:03'), 3723);
});

test('raw Whisper text becomes [m:ss] lines the analysis log can parse', () => {
  const raw =
    'Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it. ' +
    'Contractor: We will remount the mirror today.';
  const stamped = formatTimestampedTranscript(raw);
  const lines = stamped.split('\n');
  assert.ok(lines.length >= 2, 'speaker turns become separate lines');
  assert.match(lines[0]!, /^\[0:00\] Homeowner:/);
  assert.match(stamped, /\[0:00\] Contractor:/);
  lines.forEach((line) => {
    assert.match(line, /^\[(?:\d+:)+\d+\]\s+\S/);
  });
});

test('Whisper segment clocks offset by the 10-minute slice start', () => {
  const stamped = formatTimestampedTranscript('', {
    offsetSeconds: 600,
    segments: [
      { start: 12, text: ' We will remount the mirror today. ' },
      { start: 48, text: 'Please do not cut the hallway.' },
    ],
  });
  assert.equal(
    stamped,
    '[10:12] We will remount the mirror today.\n[10:48] Please do not cut the hallway.',
  );
});

test('already-stamped transcripts stay stamped and are not double-wrapped', () => {
  const input =
    '[0:18] Homeowner: The leak started behind the vanity.\n' +
    '[1:36] Contractor: We will remount the mirror today.';
  assert.equal(formatTimestampedTranscript(input), input);
});

test('splitTranscriptUtterances keeps speaker turns intact', () => {
  const parts = splitTranscriptUtterances(
    'Homeowner: Leave the cabinets. Contractor: Understood. We will remount the mirror.',
  );
  assert.ok(parts.some((p) => /Homeowner:/i.test(p)));
  assert.ok(parts.some((p) => /Contractor:/i.test(p)));
});

test('transcriptFromProviderBody reads verbose_json segments and plain text', () => {
  const verbose = transcriptFromProviderBody({
    text: 'Hello there.',
    segments: [
      { start: 1.2, end: 3.4, text: ' Hello there. ' },
      { start: 5, text: '' },
    ],
  });
  assert.equal(verbose.text, 'Hello there.');
  assert.deepEqual(verbose.segments, [{ start: 1.2, end: 3.4, text: 'Hello there.' }]);

  const plain = transcriptFromProviderBody({ text: '  Just text.  ' });
  assert.equal(plain.text, 'Just text.');
  assert.deepEqual(plain.segments, []);
});

test('transcript persist writes timestamped text and conversation without wiping vision', () => {
  const existing = {
    kind: 'day_film',
    summary: 'Crew in the hallway. Talking, not working.',
    changes: [],
    actions: [{ atSeconds: 18, description: 'Standing at the bathroom door.' }],
  };
  const raw =
    'Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it. ' +
    'Contractor: We will remount the mirror today and leave the cabinets until the adjuster says go ahead.';
  const patch = transcriptPersistPatch(raw, existing);
  assert.equal(patch.transcript_status, 'done');
  assert.match(patch.transcript_text, /^\[0:00\]/);
  assert.match(patch.transcript_text, /vanity/);
  assert.equal(patch.ai_findings.kind, 'day_film');
  assert.equal(patch.ai_findings.summary, existing.summary);
  assert.ok(Array.isArray((patch.ai_findings.conversation as { details?: string[] }).details));
  const conversation = patch.ai_findings.conversation as {
    agreements?: string[];
    concerns?: string[];
    rooms?: string[];
  };
  assert.ok((conversation.agreements ?? []).some((line) => /mirror|go ahead/i.test(line)));
  assert.ok((conversation.concerns ?? []).some((line) => /insurance|cabinets/i.test(line)));
  assert.ok((conversation.rooms ?? []).includes('bathroom') || /vanity/.test(patch.transcript_text));

  const details = extractConversationDetails(patch.transcript_text);
  const merged = mergeConversationFindings(existing, details);
  assert.equal(merged.kind, 'day_film');
  assert.deepEqual(merged.actions, existing.actions);
});
