import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipAudioSource,
  describesPlayingMedia,
  provenSpeakerLabel,
  readMediaAudio,
  tagSegmentSources,
} from '../src/audio/audioSource.ts';
import { answerFromClip, type ClipAskRecord } from '../src/shared/clipAsk.ts';
import { conversationChunks, extractConversationDetails, parseConversationModelJson } from '../src/audio/conversationDetails.ts';

/* Synthetic fixtures only (public repo). */

test('a playing screen is media; an off or black screen is not', () => {
  assert.ok(describesPlayingMedia('A wall-mounted TV is playing a news broadcast with an anchor speaking.'));
  assert.ok(describesPlayingMedia('The laptop on the counter is showing a video with narration.'));
  assert.equal(describesPlayingMedia('A wall-mounted flat-screen TV (screen black/off) hangs above the bench.'), null);
  assert.equal(describesPlayingMedia('No on-screen text, broadcast, or readable branding; the TV is off throughout.'), null);
  assert.equal(describesPlayingMedia('Worker is playing out the tape measure along the baseboard.'), null);
});

test('timed media windows tag lines inside them as media, others as field', () => {
  const reading = readMediaAudio({
    hasSpeech: true,
    events: [
      { atSeconds: 0, description: 'Crew member points at the water stain on the ceiling.' },
      { atSeconds: 10, description: 'Camera pans to the living room; the TV is playing a cooking show.' },
      { atSeconds: 20, description: 'Back to the ceiling stain; moisture meter reading taken.' },
    ],
  });
  assert.equal(reading.mediaWindows.length, 1);
  assert.deepEqual([reading.mediaWindows[0]!.startSeconds, reading.mediaWindows[0]!.endSeconds], [10, 20]);
  const tagged = tagSegmentSources(
    [
      { tSec: 2, text: 'That stain goes back to the vent.' },
      { tSec: 12, text: 'Add two cups of flour and stir.' },
      { tSec: 22, text: 'Reading is eighteen percent.' },
    ],
    reading,
  );
  assert.deepEqual(tagged.map((row) => row.source), ['field', 'media', 'field']);
  assert.equal(clipAudioSource(tagged.map((row) => row.source), reading), 'mixed');
});

test('broadcast phrasing is media; untimed screen mention leaves lines unknown', () => {
  const reading = readMediaAudio({ hasSpeech: true, narration: 'A laptop on the table is playing a video throughout.' });
  const tagged = tagSegmentSources(
    [
      { tSec: 1, text: 'Stay tuned, coming up next.' },
      { tSec: 5, text: 'Is this the room?' },
    ],
    reading,
  );
  assert.deepEqual(tagged.map((row) => row.source), ['media', 'unknown']);
  const none = tagSegmentSources([{ tSec: 1, text: 'Hello.' }], readMediaAudio({ hasSpeech: true, narration: 'The TV is off.' }));
  assert.equal(none[0]!.source, 'field');
});

test('made-up speaker labels become unknown; proven roles and names stay', () => {
  for (const label of ['Speaker A', 'SPEAKER B', 'speaker_1', 'Person 2', 'A', '', null, 'Speaker']) {
    assert.equal(provenSpeakerLabel(label), 'unknown', String(label));
  }
  assert.equal(provenSpeakerLabel('Homeowner'), 'Homeowner');
  assert.equal(provenSpeakerLabel('Dana Ortiz'), 'Dana Ortiz');
});

test('deterministic conversation turns never invent Speaker A', () => {
  assert.ok(conversationChunks('[0:01] hello there. [0:04] okay then.').length === 2);
  const details = extractConversationDetails('[0:01] We will start on the vanity tomorrow. [0:04] Sounds good to me.');
  assert.ok((details.turns ?? []).length > 0);
  for (const turn of details.turns ?? []) assert.equal(turn.speakerLabel, 'unknown');
  const parsed = parseConversationModelJson(
    JSON.stringify({ summary: 's', turns: [{ tSec: 1, speakerLabel: 'Speaker A', text: 'We will start tomorrow.' }, { tSec: 4, speakerLabel: 'Homeowner', text: 'Sounds good.' }] }),
    details,
  );
  assert.deepEqual(parsed?.turns?.map((turn) => turn.speakerLabel), ['unknown', 'Homeowner']);
});

const kitchen: ClipAskRecord = {
  analysisState: 'done',
  durationSeconds: 30,
  transcriptStatus: 'done',
  dictation: 'Walkthrough of a kitchen with water damage under the sink.',
  actions: [
    { atSeconds: 0, description: 'Close-up of swollen cabinet floor under the sink.' },
    { atSeconds: 10, description: 'A TV in the next room is playing a home-shopping show.' },
    { atSeconds: 20, description: 'Back to the cabinet; tech points at the supply line.' },
  ],
  mediaWindows: [{ startSeconds: 10, endSeconds: 20, device: 'tv', evidence: 'A TV in the next room is playing a home-shopping show.' }],
  transcript: [
    '[0:02] The floor is swollen right here.',
    '[0:12] Only four hundred dollars today, call now.',
    '[0:15] That price will not last.',
    '[0:22] The supply line is leaking at the nut.',
  ].join('\n'),
};

test('count answer marks media lines and says they are not field conversation', async () => {
  const r = await answerFromClip({ question: 'How many lines are in the transcript?', record: kitchen });
  assert.match(r.answer, /\*\*4\*\* lines/);
  assert.match(r.answer, /2 of them are audio from a screen playing in frame \(media\), not field conversation/);
  assert.match(r.answer, /\[0:12\] “Only four hundred dollars today, call now\.” _\(media/);
  assert.doesNotMatch(r.answer, /\[0:02\][^\n]*media/);
});

test('a price heard only from the TV is not a price anyone on site stated', async () => {
  const r = await answerFromClip({ question: 'Did anyone mention a price?', record: kitchen });
  assert.match(r.answer, /^No, not by anyone on site\./);
  assert.match(r.answer, /media/);
});

test('a letter label written in the transcript itself is kept', () => {
  assert.equal(provenSpeakerLabel('Speaker A', '[0:05] Speaker A: Welcome back.'), 'Speaker A');
  assert.equal(provenSpeakerLabel('Speaker B', '[0:05] Speaker A: Welcome back.'), 'unknown');
  assert.equal(provenSpeakerLabel('Speaker A', [{ speakerLabel: 'Speaker A' }]), 'Speaker A');
});

test('a screen merely present, or "anchor"/"commercial" gear, is not playback', () => {
  assert.equal(describesPlayingMedia('A TV is on the wall above the fireplace.'), null);
  assert.equal(describesPlayingMedia('A laptop is on the counter next to the sink.'), null);
  assert.equal(describesPlayingMedia('Roof anchor installed near the ridge; a TV antenna beside it.'), null);
  assert.equal(describesPlayingMedia('A commercial dehumidifier sits by the TV stand.'), null);
  assert.ok(describesPlayingMedia('The TV is showing a news broadcast with an anchor at the desk.'));
});

test('Ask tags broadcast phrasing as media even with no screen described', async () => {
  const r = await answerFromClip({
    question: 'How many lines are in the transcript?',
    record: { analysisState: 'done', transcriptStatus: 'done', dictation: 'Parked car interior.', transcript: "[0:16] Don't forget to like and subscribe to the channel." },
  });
  assert.match(r.answer, /media/);
});
