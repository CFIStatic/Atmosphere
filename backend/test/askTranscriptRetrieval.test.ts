/**
 * Job-level Ask retrieval over raw transcript chunks, quote grounding, and
 * speaker labels. All lines here are made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AskLookupCatalog, AskLookupClip } from '../src/shared/askLookup.js';
import { chunkClipTranscript, retrieveAskEvidence, searchPhrases } from '../src/shared/askTranscriptIndex.js';
import { composeTopicSpeech, topicEvidence } from '../src/shared/askEvidenceAnswer.js';
import { enforceQuoteGrounding } from '../src/shared/askQuoteGrounding.js';
import {
  diarizationLabel,
  diarizedSpeakerLabels,
  isFabricatedSpeakerLabel,
  sanitizeSpeakerProse,
  speakerLabelOrUnidentified,
} from '../src/shared/askSpeakers.js';
import { formatQuoteTrailer, parseQuoteTrailer } from '../src/shared/askMoments.js';
import { transcriptChunkRows, transcriptSha256, chunkSearchQuery } from '../src/shared/askTranscriptChunkStore.js';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';
import { PRIVACY_REDACTED_LABEL } from '../src/audio/privacyRedactions.js';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const JOB = '00000000-0000-4000-8000-0000000000a2';
const TABLE = '00000000-0000-4000-8000-0000000000b1';
const DOG = '00000000-0000-4000-8000-0000000000b2';
const OLD = '00000000-0000-4000-8000-0000000000b3';

function clip(partial: Partial<AskLookupClip> & Pick<AskLookupClip, 'proofId' | 'title'>): AskLookupClip {
  return { jobId: JOB, orgId: ORG, recordedByUserIds: [], ...partial };
}

const TABLE_TITLE = 'Short Handheld Phone Clip Surveys a Dining Table';

const catalog: AskLookupCatalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Synthetic Kitchen Office Job',
  timeZone: 'America/Chicago',
  people: [{ userId: 'u1', name: 'Pat Doe', onThisJob: true, recordedProofIds: [TABLE, DOG, OLD], taggedProofIds: [] }],
  history: [],
  clips: [
    clip({
      proofId: TABLE,
      title: TABLE_TITLE,
      workDate: '2026-09-21',
      summary: 'Handheld phone video at a dining table; people talk about paperwork.',
      speakers: [],
      segments: [
        { start: 0, end: 2.9, text: 'The whole list is still on paper.' },
        { start: 3.1, end: 4.6, text: 'Everyone keeps it in a binder, every single week, without fail.' },
        { start: 14.6, end: 16.5, text: 'We just have to switch to LedgerPro cloud.' },
        { start: 16.7, end: 18.4, text: "That's the main thing." },
        { start: 18.56, end: 19.7, text: "Okay, I'm going to set it up now." },
        { start: 21.4, end: 22.6, text: 'I think the door sticks and the hinge squeaks loudly.' },
      ],
    }),
    clip({
      proofId: DOG,
      title: 'Close-Up of a Sleeping Dog on a Couch',
      workDate: '2026-09-21',
      summary: 'A dog asleep on a couch.',
      segments: [
        { start: 0, end: 1.2, text: 'All her life.' },
        { start: 10.6, end: 12, text: 'That dog is the best dog in the whole wide world.' },
      ],
    }),
    clip({
      proofId: OLD,
      title: 'Garage Walkthrough',
      workDate: '2026-09-10',
      summary: 'Garage walkthrough.',
      segments: [{ start: 5, end: 7, text: 'The LedgerPro cloud login is on the fridge.' }],
    }),
  ],
};

const QUESTION = 'What was said about LedgerPro cloud on September 21, and at what timestamps? Who committed to doing it?';

test('a verbatim noun phrase in the question always surfaces its transcript chunk', () => {
  const evidence = retrieveAskEvidence(catalog, QUESTION);
  assert.ok(evidence.phrases.some((p) => p.toLowerCase() === 'ledgerpro cloud'), evidence.phrases.join(','));
  const top = evidence.transcript.find((hit) => hit.pinned);
  assert.ok(top, 'pinned hit');
  assert.equal(top!.text, 'We just have to switch to LedgerPro cloud.');
  assert.equal(top!.startSec, 14.6);
  assert.equal(top!.proofId, TABLE);
});

test('a who-committed question pulls in the commitment line right after the hit', () => {
  const evidence = retrieveAskEvidence(catalog, QUESTION);
  assert.equal(evidence.asksOwner, true);
  const commit = evidence.transcript.find((hit) => hit.reason === 'commitment');
  assert.ok(commit);
  assert.equal(commit!.text, "Okay, I'm going to set it up now.");
  assert.equal(commit!.startSec, 18.56);
});

test('the date filter keeps other days out, and reports them when the day has nothing', () => {
  const evidence = retrieveAskEvidence(catalog, QUESTION);
  assert.ok(evidence.transcript.every((hit) => hit.workDate === '2026-09-21'));
  const other = retrieveAskEvidence(catalog, 'What was said about LedgerPro cloud on September 23?');
  assert.equal(other.transcript.length, 0);
  assert.ok(other.otherDays.some((hit) => hit.proofId === OLD));
});

test('the deterministic answer quotes both lines verbatim with clip and time, and the owner is unidentified', () => {
  const answer = composeTopicSpeech(QUESTION, catalog)!;
  assert.ok(answer);
  assert.match(answer, /- “We just have to switch to LedgerPro cloud\.” \(Short Handheld Phone Clip Surveys a Dining Table, 0:15\)/);
  assert.match(answer, /- “Okay, I'm going to set it up now\.” \(Short Handheld Phone Clip Surveys a Dining Table, 0:19\)/);
  assert.match(answer, /unidentified speaker/);
  assert.doesNotMatch(answer, /All her life|best dog|door sticks|on paper/);
});

test('something that is in no clip is reported as not found', () => {
  const evidence = topicEvidence('What was said about the roof permit, and when?', catalog);
  assert.ok(evidence);
  const answer = composeTopicSpeech('What was said about the roof permit, and when?', catalog, evidence)!;
  assert.match(answer, /Nothing in the transcripts on this job mentions “roof permit”/);
  assert.doesNotMatch(answer, /“(?!roof permit)[^”]+”/);
});

test('a question naming a clip is left to the clip path', () => {
  assert.equal(topicEvidence('what was said in the garage walkthrough', catalog), null);
});

test('stop words, dates, and people are not search phrases', () => {
  const { phrases } = retrieveAskEvidence(catalog, 'What did Pat say about the LedgerPro cloud on September 21?');
  assert.ok(searchPhrases('What was said on September 21?').phrases.length === 0);
  assert.ok(phrases.some((p) => p.toLowerCase() === 'ledgerpro cloud'), phrases.join(','));
  assert.ok(!phrases.some((phrase) => /september|what|say|pat/i.test(phrase)), phrases.join(','));
});

test('the full pipeline returns both lines and quote cards with clip names, even with no model', async () => {
  const result = await answerFromAskLookup({ question: QUESTION, catalog, step: async () => null, repair: async () => null } as never);
  assert.match(result.answer, /“We just have to switch to LedgerPro cloud\.”/);
  assert.match(result.answer, /“Okay, I'm going to set it up now\.”/);
  const quotes = parseQuoteTrailer(result.answer);
  assert.deepEqual(quotes.map((q) => q.atSeconds), [14.6, 18.56]);
  assert.ok(quotes.every((q) => q.clipTitle === TABLE_TITLE && q.speaker === 'Unidentified speaker'));
  assert.ok(quotes.every((q) => q.sourceId.includes(`${TABLE}/`) && q.sourceId.includes('@')));
});

/* ---------------------------------------------------------- chunking -- */

test('chunks carry clip id, start/end, and exact text; redacted spans never become chunks', () => {
  const chunks = chunkClipTranscript(
    clip({
      proofId: TABLE,
      title: 'x',
      segments: [
        { start: 1, end: 2, text: 'First line.' },
        { start: 3, end: 4, text: `${PRIVACY_REDACTED_LABEL}` },
        { start: 5, end: 6, text: 'SPEAKER_01: Third line.' },
      ],
    }),
  );
  assert.deepEqual(
    chunks.map((c) => [c.key.startsWith(`${TABLE}#`), c.startSec, c.endSec, c.text]),
    [
      [true, 1, 2, 'First line.'],
      [true, 5, 6, 'Third line.'],
    ],
  );
  assert.equal(chunks[1]!.speaker, 'Speaker 2');
});

test('stored chunk rows keep the raw transcript and a stable hash', () => {
  const row = {
    id: TABLE,
    org_id: ORG,
    job_id: JOB,
    title: 'x',
    transcript_text: null,
    transcript_segments: [{ start: 14.6, end: 16.5, text: 'We just have to switch to LedgerPro cloud.' }],
    transcript_words: null,
  };
  const rows = transcriptChunkRows(row as never);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.proof_id, TABLE);
  assert.equal(rows[0]!.start_sec, 14.6);
  assert.equal(rows[0]!.text, 'We just have to switch to LedgerPro cloud.');
  assert.equal(rows[0]!.transcript_sha256, transcriptSha256(row as never));
  assert.match(chunkSearchQuery('What was said about LedgerPro cloud?'), /ledgerpro/i);
});

/* ---------------------------------------------------- quote grounding -- */

const chunks = retrieveAskEvidence(catalog, QUESTION).chunks;

test('an unverifiable quote is dropped with its sentence, and nothing is said about it', () => {
  const { answer, report } = enforceQuoteGrounding(
    'On Sep 21:\n- “We are migrating everything to LedgerPro next month.”\n- “We just have to switch to LedgerPro cloud.”',
    { chunks, question: QUESTION },
  );
  assert.doesNotMatch(answer, /migrating everything/);
  assert.match(answer, /“We just have to switch to LedgerPro cloud\.” \(Short Handheld Phone Clip Surveys a Dining Table, 0:15\)/);
  assert.equal(report.dropped, 1);
  assert.equal(report.verified, 1);
});

test('a near-verbatim quote is rewritten to the exact transcript text, never paraphrased', () => {
  const { answer } = enforceQuoteGrounding('- "we just have to switch to ledgerpro cloud" (0:00)', { chunks, question: QUESTION });
  assert.match(answer, /“We just have to switch to LedgerPro cloud\.”/);
  assert.match(answer, /\(Short Handheld Phone Clip Surveys a Dining Table, 0:15\)/);
  assert.doesNotMatch(answer, /0:00/);
});

test('verified quotes become cards that open the exact moment, and fabricated cards are removed', () => {
  const bad = `x@3|Speaker|We are migrating everything.`;
  const { answer } = enforceQuoteGrounding(
    `The line is “Okay, I'm going to set it up now.”\n\n⟦quotes: video/${JOB}/${TABLE}/y@0|Person 1 (Seated|${bad}⟧`,
    { chunks, question: QUESTION },
  );
  const quotes = parseQuoteTrailer(answer);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0]!.atSeconds, 18.56);
  assert.equal(quotes[0]!.speaker, 'Unidentified speaker');
  assert.doesNotMatch(quotes[0]!.speaker, /\(|Seated|Role/);
  assert.doesNotMatch(answer, /Person \d|Seated|Unknown Role/);
  assert.equal(quotes[0]!.clipTitle, TABLE_TITLE);
  assert.doesNotMatch(answer, /migrating|Person 1/);
});

test('a two-word term in quotes is not treated as a transcript quote', () => {
  const { answer } = enforceQuoteGrounding('Nothing in the transcripts on this job mentions “roof permit”.', { chunks, question: 'roof permit?' });
  assert.match(answer, /“roof permit”/);
});

/* ------------------------------------------------------------ speakers -- */

test('only diarization labels are used as speakers', () => {
  assert.equal(diarizationLabel('SPEAKER_00'), 'Speaker 1');
  assert.equal(diarizationLabel('Speaker 2'), 'Speaker 2');
  assert.equal(diarizationLabel('Person 1 (Seated, Unknown Role)'), 'Speaker 1');
  assert.equal(diarizationLabel('Person 1 (Seated'), 'Speaker 1');
  assert.equal(isFabricatedSpeakerLabel('Seated man'), true);
  assert.equal(isFabricatedSpeakerLabel('homeowner'), true);
  assert.equal(speakerLabelOrUnidentified('Person 1 (Seated, Unknown Role)'), 'Speaker 1');
  assert.equal(speakerLabelOrUnidentified('Person 1 (Seated'), 'Speaker 1');
  assert.equal(speakerLabelOrUnidentified('Seated man'), 'Unidentified speaker');
  assert.doesNotMatch(speakerLabelOrUnidentified('Person 1 (Seated, Unknown Role)'), /\(|Seated|Role|homeowner/i);
  assert.deepEqual(
    diarizedSpeakerLabels({
      people: {
        people: [{ label: 'Person 1 (Seated, Unknown Role)' }],
        speakers: [{ speakerLabel: 'Person 1', displayName: 'Seated man' }],
      },
    }),
    ['Speaker 1'],
  );
});

test('fabricated labels and unclosed parens are removed from prose', () => {
  const cleaned = sanitizeSpeakerProse(
    'Person 1 (Seated said the binder is full. Then Person 1 (Unknown Role said “Watch your step.” and Person 2 (Standing, Homeowner) nodded.',
  );
  assert.doesNotMatch(cleaned, /Person \d|Seated|Unknown Role|Standing|Homeowner|\(/);
  assert.match(cleaned, /^Speaker 1 said the binder is full\. Then Speaker 1 said “Watch your step\.” and Speaker 2 nodded\./);
  const opens = (cleaned.match(/\(/g) ?? []).length;
  const closes = (cleaned.match(/\)/g) ?? []).length;
  assert.equal(opens, closes);
});

test('the quote trailer round-trips the clip name', () => {
  const trailer = formatQuoteTrailer([
    { sourceId: `video/${JOB}/${TABLE}/t@14.6`, speaker: 'Unidentified speaker', text: 'We just have to switch to LedgerPro cloud.', atSeconds: 14.6, clipTitle: TABLE_TITLE },
  ]);
  const [quote] = parseQuoteTrailer(trailer);
  assert.equal(quote!.clipTitle, TABLE_TITLE);
  assert.equal(quote!.atSeconds, 14.6);
  assert.equal(quote!.text, 'We just have to switch to LedgerPro cloud.');
});

/* ------------------------------------------------------ review fixes -- */

test('a topic word that is also in a clip title still searches the transcripts', () => {
  const evidence = topicEvidence('What was said about the dog?', catalog);
  assert.ok(evidence);
  assert.ok(evidence!.transcript.some((hit) => /best dog/.test(hit.text)));
});

test('a line with a colon keeps its full text; only diarization prefixes are speakers', () => {
  const chunks = chunkClipTranscript(
    clip({ proofId: TABLE, title: 'x', segments: [{ start: 1, end: 3, text: 'The issue is this: the door sticks.' }] }),
  );
  assert.equal(chunks[0]!.text, 'The issue is this: the door sticks.');
  assert.equal(chunks[0]!.speaker, null);
});

test('the speaker sanitizer never rewrites quoted speech or clip titles', () => {
  const title = 'Person 1 Walks the Seated Man Through the Kitchen';
  const out = sanitizeSpeakerProse(
    `Person 1 (Seated said “Ask the seated man about Person 2.” in ${title}.\n- “Ask the seated man about Person 2.” (${title}, 0:04)`,
    { protect: [title] },
  );
  assert.match(out, /^Speaker 1 said “Ask the seated man about Person 2\.”/);
  assert.doesNotMatch(out.split('“')[0] ?? '', /\(|Seated|Person/);
  assert.equal(out.split(title).length - 1, 2);
  assert.match(out, /\(Person 1 Walks the Seated Man Through the Kitchen, 0:04\)/);
});

test('a failed chunk write leaves the old rows in place', async () => {
  const calls: string[] = [];
  const row = {
    id: TABLE,
    org_id: ORG,
    job_id: JOB,
    title: 'x',
    transcript_text: null,
    transcript_segments: [{ start: 1, end: 2, text: 'One line.' }],
    transcript_words: null,
  };
  const admin = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      upsert: async () => {
        calls.push(`upsert:${table}`);
        return { error: { message: 'boom' } };
      },
      delete: () => {
        calls.push(`delete:${table}`);
        return { eq: () => ({ gte: async () => ({ error: null }) }) };
      },
    }),
  };
  const { writeTranscriptChunks } = await import('../src/shared/askTranscriptChunkStore.js');
  assert.equal(await writeTranscriptChunks(admin, TABLE), null);
  assert.deepEqual(calls, ['upsert:ask_transcript_chunks']);
});
