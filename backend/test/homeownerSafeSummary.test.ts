/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';
import { homeownerProofPayload } from '../src/shared/homeownerProofPayload.js';
import { composeHomeownerLiveStory } from '../src/shared/homeownerLiveStory.js';
import { homeownerSafeText, NEUTRAL_CLIP_LINE } from '../src/shared/homeownerSafeSummary.js';

const JUNK =
  'This clip contains no job-site conversation whatsoever. Every word of audio comes from a YouTube video playing on the Dell monitor. The Diary Of A CEO episode titled "How to win" is audible.';
const ASR = 'Crew removed wet drywall in the kitchen. Repeated ASR noise/hallucination artifact text (e.g. "チョコレートチップス") cannot be treated as speech.';
const BANNED = /ASR|hallucinat|artifact|job-site conversation|YouTube|Diary Of A CEO|チョコ|cannot be treated|monitor/i;

test('homeownerSafeText drops analyst sentences and keeps plain work', () => {
  assert.equal(homeownerSafeText(JUNK), null);
  assert.equal(homeownerSafeText(ASR), 'Crew removed wet drywall in the kitchen.');
  assert.equal(homeownerSafeText('Installed new baseboards in the hallway.'), 'Installed new baseboards in the hallway.');
});

test('viewer payload never carries raw analysis; junk clips get a neutral line', () => {
  const office = {
    days: [{ workDate: '2026-10-01', aiSummary: JUNK, proofIds: ['a'] }, { workDate: '2026-10-02', aiSummary: ASR, proofIds: ['b'] }],
    videos: [
      { id: 'a', aiSummary: JUNK, people: { peoplePresent: [{ label: 'Media (YouTube video on monitor)' }], peopleSpeakers: [{ speakerLabel: 'Media (YouTube video on monitor)' }] }, conversation: { executiveSummary: JUNK, keyMoments: ['YouTube podcast playing'] }, transcriptText: 'チョコレートチップス', dictationEntries: [{ text: JUNK }] },
      { id: 'b', aiSummary: ASR, conversation: { executiveSummary: ASR, keyMoments: [{ text: 'Drywall cut out to 2 ft' }, { text: 'ASR artifact' }] } },
    ],
  };
  const out: any = homeownerProofPayload(office as any);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, BANNED);
  assert.equal(out.videos[0].homeownerSummary, NEUTRAL_CLIP_LINE);
  assert.equal(out.days[0].summary, NEUTRAL_CLIP_LINE);
  assert.equal(out.days[1].summary, 'Crew removed wet drywall in the kitchen.');
  assert.deepEqual(out.videos[1].conversation.keyMoments, [{ text: 'Drywall cut out to 2 ft' }]);
  assert.doesNotMatch(JSON.stringify(composeHomeownerLiveStory(out.videos)), BANNED);
});

test('viewer conversation is an allowlist; speaker notes, details and junk transcript lines are gone', () => {
  const office = {
    days: [],
    videos: [
      {
        id: 'c',
        aiSummary: 'Dehumidifiers and air movers staged in the basement.',
        conversation: {
          conversationExecutiveSummary:
            'Because nobody narrates, the office has no recorded agreements from this video.',
          conversationDetails: ['Transcript is limited to repeated ASR noise/hallucination artifacts.'],
          conversationUnresolvedQuestions: [{ quote: 'チョコレートチップス' }],
          transcriptSegments: [{ text: 'チョコレートチップス' }],
        },
        transcriptText: '[0:29] チョコレートチップス\n[0:40] Moving the fan here.',
        transcriptSegments: [{ text: 'チョコレートチップス' }, { text: 'Moving the fan here.' }],
        people: { peoplePresent: [{ label: 'Media (YouTube video on monitor)' }, { label: 'Technician' }] },
      },
    ],
  };
  const out: any = homeownerProofPayload(office as any);
  assert.doesNotMatch(JSON.stringify(out), /nobody narrates|the office has|ASR|チョコ|YouTube/);
  assert.equal(out.videos[0].transcriptText, '[0:40] Moving the fan here.');
  assert.deepEqual(out.videos[0].people.peoplePresent, [{ label: 'Technician' }]);
  const story = composeHomeownerLiveStory(out.videos);
  assert.match(story.moments[0].glance ?? '', /Dehumidifiers/);
});

test('cut-off upstream text never ends in half a word', () => {
  assert.equal(homeownerSafeText('Fans were set. Areas covered include a utility corner and a hom'), 'Fans were set.');
});
