import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerFromClip,
  clipRecordFromEvidenceItem,
  formatClipRecordForModel,
  groundedAnswerFromClip,
  withAuthoritativeTranscript,
  type ClipAskRecord,
} from '../src/shared/clipAsk.ts';
import type { AskLookupCatalog } from '../src/shared/askLookup.ts';
import { answerQualityFailures, buildGroundingIndex, normalizeForMatch, verifyAskAnswer } from '../src/shared/askVerify.ts';
import { speechCountContradictions, isSpeechCountQuestion } from '../src/shared/speechCount.ts';

/*
 * Synthetic stand-ins for the reported cases (the repo is public; no real clip
 * content). The 44-second walkthrough: five transcript lines, and an AI summary
 * left over from a one-line transcript.
 */
const FIVE = [
  '[0:00] first short line.',
  '[0:11] second line about the room.',
  '[0:30] third line.',
  '[0:35] fourth line here.',
  '[0:38] fifth line.',
].join('\n');
const STALE_BRIEF =
  'This 44-second clip is a walkthrough. The only speech captured in the entire recording is a single context-free fragment, "First short line."';

const walkthrough: ClipAskRecord = {
  analysisState: 'done',
  durationSeconds: 44,
  transcriptStatus: 'done',
  dictation:
    'Handheld walkthrough of a furnished interior: a recessed can light and a chandelier shade on the ceiling, a wall clock with a printed maker\'s name on the dial, wicker chairs with blue cushions.',
  actions: [
    { atSeconds: 1, description: 'Camera holds on the ceiling can light and chandelier shade.' },
    { atSeconds: 5, description: 'Pan across the wall clock.' },
  ],
  transcript: FIVE,
  conversationExecutiveSummary: STALE_BRIEF,
  conversationSummary: 'Walkthrough with only one stray spoken fragment.',
  conversationTurns: [{ tSec: null, speakerLabel: 'Speaker A', text: 'First short line.' }],
};

test('count question: the number comes first, from the raw transcript, and the stale summary is gone', async () => {
  const q = 'How many distinct spoken utterances are transcribed in this 44-second clip? Quote each one and its timestamp.';
  assert.ok(isSpeechCountQuestion(q));
  const { answer, model } = await answerFromClip({ question: q, record: walkthrough });
  assert.equal(model, null);
  assert.match(answer, /^There are \*\*5\*\* lines in the raw transcript/);
  for (const stamp of ['0:00', '0:11', '0:30', '0:35', '0:38']) assert.match(answer, new RegExp(`\\[${stamp}\\]`));
  assert.doesNotMatch(answer, /only speech|single|one stray|fragment/i);
  assert.deepEqual(speechCountContradictions(answer, [5]), []);
});

test('a summary that contradicts the transcript is dropped from every Ask path and the model context', () => {
  const cleaned = withAuthoritativeTranscript(walkthrough);
  assert.equal(cleaned.conversationStale, true);
  assert.equal(cleaned.conversationExecutiveSummary, null);
  assert.deepEqual(cleaned.conversationTurns, []);
  const reading = formatClipRecordForModel(walkthrough);
  assert.match(reading, /Raw transcript \(authoritative; verbatim Whisper; 5 lines/);
  assert.doesNotMatch(reading, /only speech|single context-free/);
  assert.ok(reading.indexOf('Raw transcript') < reading.indexOf('AI description of the whole clip'));
  const topic = groundedAnswerFromClip('What are they talking about?', walkthrough);
  assert.doesNotMatch(topic, /only speech|single context-free|Yes — they are talking about this/);
});

test('summaryState from the library (updating / quarantined) marks the conversation stale', () => {
  for (const summaryState of ['updating', 'quarantined', 'failed']) {
    const record = clipRecordFromEvidenceItem({
      analysisState: 'done',
      analysis: { transcript: FIVE, conversationExecutiveSummary: 'Five short lines.', summaryState } as ClipAskRecord,
    });
    assert.equal(record.conversationStale, true, summaryState);
    assert.doesNotMatch(formatClipRecordForModel(record), /Five short lines/);
  }
  const fresh = clipRecordFromEvidenceItem({
    analysisState: 'done',
    analysis: { transcript: FIVE, conversationExecutiveSummary: 'Five short lines.', summaryState: 'fresh' } as ClipAskRecord,
  });
  assert.match(formatClipRecordForModel(fresh), /AI summary of the conversation \(may be stale.*\): Five short lines\./);
});

test('a narrow speech question gets one direct sentence and only the matching line, with its time', () => {
  const office: ClipAskRecord = {
    analysisState: 'done',
    transcriptStatus: 'done',
    transcript: [
      '[0:02] Okay, let me set this down.',
      "[0:09] Well, we've just got to get that.",
      '[0:15] We need to switch to BooksApp online.',
      '[0:21] Where is the charger?',
      '[0:30] Turn that off for a second.',
      '[0:41] Alright, that works.',
    ].join('\n'),
    conversationExecutiveSummary: 'The only speech is a single fragment.',
  };
  const answer = groundedAnswerFromClip('What was said about BooksApp and when?', office);
  const [lead] = answer.split('\n');
  assert.match(lead!, /BooksApp.*0:15/);
  assert.match(answer, /\[0:15\] “We need to switch to BooksApp online\.”/);
  assert.doesNotMatch(answer, /charger|Turn that off|single fragment|Yes — they are talking/);
  assert.deepEqual(
    answerQualityFailures({
      question: 'What was said about BooksApp and when?',
      answer,
      transcripts: [office.transcript!.split('\n')],
      evidenceNorm: normalizeForMatch(office.transcript!),
    }),
    [],
  );
});

test('a false premise is answered plainly as not shown; no speech dump', async () => {
  const trick = 'At what timestamp does the worker install the replacement ceiling light, and what brand is it?';
  const { answer } = await answerFromClip({ question: trick, record: walkthrough });
  assert.match(answer, /^The footage on file does not show that\./);
  assert.match(answer, /install|replacement|brand/);
  assert.doesNotMatch(answer, /first short line|Exact words/);

  const brand = groundedAnswerFromClip('What brand is the wall clock?', walkthrough);
  assert.match(brand, /^The footage on file does not show that\./);
  assert.match(brand, /printed name or label/);

  const insurance = groundedAnswerFromClip('Did anyone mention insurance?', walkthrough);
  assert.match(insurance, /^No\. Not established: the raw transcript \(5 lines\) never mentions “insurance”/);
});

test('answerQualityFailures: yes/no consistency, count, timestamp, relevance, dump, unsupported claims', () => {
  const transcripts = [FIVE.split('\n')];
  const evidenceNorm = normalizeForMatch(`${FIVE}\n${walkthrough.dictation}`);
  const kinds = (question: string, answer: string) =>
    answerQualityFailures({ question, answer, transcripts, evidenceNorm }).map((failure) => failure.kind);

  assert.deepEqual(kinds('Did they replace the ceiling light?', 'Yes. The footage on file does not show that.'), ['yes_no']);
  assert.ok(kinds('How many lines are in the transcript?', 'The clip is a walkthrough of a furnished interior.').includes('count_missing'));
  assert.ok(kinds('When is the wall clock shown?', 'The wall clock is shown during the pan.').includes('timestamp_missing'));
  assert.deepEqual(kinds('When is the wall clock shown?', 'The wall clock is shown at 0:05.'), []);
  assert.ok(kinds('What color are the chair cushions?', 'The crew finished for the day.').includes('irrelevant'));
  assert.ok(kinds('What was said about the room?', `Here it is: ${FIVE}`).includes('transcript_dump'));
  assert.deepEqual(kinds('How many lines are in the transcript?', `There are 5 lines: ${FIVE}`), []);
  assert.ok(kinds('What did they do?', 'They installed the new vanity and it cost $1,200.').filter((k) => k === 'unsupported_claim').length >= 2);
  assert.ok(kinds('What happens next?', 'The contractor agreed to come back Friday.').includes('unsupported_claim'));
  assert.deepEqual(kinds('Was a vanity installed?', 'No. The footage on file does not show a vanity being installed.'), []);
});

test('askVerify flags a job-level answer that repeats the stale speech count', () => {
  const catalog: AskLookupCatalog = {
    orgId: 'o',
    jobId: 'j',
    access: 'org',
    jobTitle: 'Synthetic job',
    timeZone: 'America/Chicago',
    clips: [{ proofId: 'p', jobId: 'j', orgId: 'o', title: 'Walkthrough', transcript: FIVE, summary: STALE_BRIEF }],
    people: [],
    history: [],
  };
  const index = buildGroundingIndex({ catalog, question: 'How many lines were said on the walkthrough?' });
  const bad = verifyAskAnswer('The only speech in the entire recording is a single fragment.', index);
  assert.ok(bad.open.some((failure) => failure.kind === 'speech_count'), JSON.stringify(bad.open));
  const good = verifyAskAnswer('There are 5 lines in the walkthrough transcript.', index);
  assert.equal(good.open.filter((failure) => failure.kind === 'speech_count').length, 0);
  assert.deepEqual(good.quality, []);
  const unsupported = verifyAskAnswer('The crew installed the new ceiling fan for $450.', buildGroundingIndex({ catalog, question: 'What work was done?' }));
  assert.ok(unsupported.open.some((failure) => failure.kind === 'unsupported_claim'));
});

/* Synthetic stand-in for the accounting-software clip: fifteen lines, one names the app at 0:15. */
const accounting: ClipAskRecord = {
  analysisState: 'done',
  durationSeconds: 34,
  transcriptStatus: 'done',
  dictation: 'Close survey of a wood tabletop; a wall-mounted flat-screen TV (screen black/off) and framed prints behind.',
  actions: [
    { atSeconds: 7, description: 'Camera lifts; a carton on the table and a dark TV edge at top.' },
    { atSeconds: 25, description: 'Camera tilts up to the wall-mounted TV (screen off/black) and wallpaper.' },
  ],
  transcript: [
    '[0:00] It is all on paper here.',
    '[0:05] You have it on a table.',
    '[0:13] Well, we need to get that.',
    '[0:15] We need to move to LedgerApp online.',
    '[0:17] That is the main thing.',
  ].join('\n'),
};

test('topic question returns only the matching timed line, not the whole transcript', async () => {
  const r = await answerFromClip({ question: 'What was said about LedgerApp and when?', record: accounting });
  assert.match(r.answer, /^“LedgerApp” comes up at 0:15\./);
  assert.match(r.answer, /\[0:15\] “We need to move to LedgerApp online\.”/);
  assert.doesNotMatch(r.answer, /main thing|on paper/);
});

test('yes/no with only a partial word match is not a yes', async () => {
  const r = await answerFromClip({ question: 'Did they agree on a price for the table repair?', record: accounting });
  assert.match(r.answer, /^No\. Not established/);
  assert.doesNotMatch(r.answer, /^Yes/);
});

test('on/off question answers from the stated state, not from a mention', async () => {
  const r = await answerFromClip({ question: 'Is the TV on?', record: accounting });
  assert.match(r.answer, /^No\./);
  assert.match(r.answer, /off/);
});

test('on/off: "on" as a preposition is not the device being on', async () => {
  const record: ClipAskRecord = {
    analysisState: 'done',
    transcriptStatus: 'done',
    dictation: 'A pendant light on the ceiling above the table; a clock on the wall.',
    actions: [{ atSeconds: 3, description: 'Camera holds on the pendant light on the ceiling.' }],
    transcript: '[0:01] Look at this.',
  };
  const r = await answerFromClip({ question: 'Is the light on?', record });
  assert.doesNotMatch(r.answer, /^Yes/);
});

test('yes/no terms found only in different lines is not a yes', async () => {
  const r = await answerFromClip({ question: 'Did they talk about paper and LedgerApp?', record: accounting });
  assert.doesNotMatch(r.answer, /^Yes/);
  assert.match(r.answer, /Not established in any single line/);
});

test('topic-scoped "only" phrases are not whole-clip speech counts', () => {
  assert.deepEqual(speechCountContradictions('The only speech about QuickBooks is at 0:15.', [5]), []);
  assert.deepEqual(speechCountContradictions('Only one line mentions the table.', [5]), []);
  assert.deepEqual(speechCountContradictions('There are two lines about the TV.', [15]), []);
  // Whole-clip claims are still caught.
  assert.ok(speechCountContradictions('The only speech is a single fragment.', [5]).length >= 1);
  assert.equal(speechCountContradictions('There is only one line in the clip.', [5]).length, 1);
});
