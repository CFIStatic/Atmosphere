import assert from 'node:assert/strict';
import test from 'node:test';
import { composeHomeownerLiveStory } from './homeownerLiveStory.js';

test('composeHomeownerLiveStory builds Glance timeline and scrubs private moments', () => {
  const story = composeHomeownerLiveStory([
    {
      id: 'a',
      workDate: '2026-09-12',
      company: 'Delgado Roofing',
      conversation: {
        conversationExecutiveSummary: 'Crew finished the north slope tear-off.',
        conversationKeyMoments: [{ text: 'Agreed to tarp overnight' }],
      },
      people: { peoplePresent: [{ displayName: 'Alex', role: 'crew' }] },
    },
    {
      id: 'b',
      workDate: '2026-09-13',
      company: 'Delgado Roofing',
      aiSummary: 'Worker walked into the bathroom while recording',
      conversation: {
        conversationSummary: 'Discussion in the bathroom about fixtures',
      },
      privacyRedactions: {
        version: 1,
        ranges: [{ startSec: 10, endSec: 40, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
      },
    },
  ]);

  assert.match(story.overview, /north slope/i);
  assert.equal(story.moments[0]?.glance?.includes('north slope'), true);
  assert.ok(story.moments[0]?.people.includes('Alex'));
  assert.doesNotMatch(JSON.stringify(story), /bathroom/i);
  assert.equal(story.moments.some((m) => m.privacyProtected), true);
});

test('composeHomeownerLiveStory explains empty jobs', () => {
  const empty = composeHomeownerLiveStory([]);
  assert.match(empty.overview, /No field clips/i);
  assert.equal(empty.moments.length, 0);
});
