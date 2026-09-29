import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groundedAnswerFromClip,
  presumedSpeakerRole,
  speakerRoleEstablished,
  type ClipAskRecord,
} from '../src/shared/clipAsk.js';

/** Tiffany & Co. job #12, 44-second clip c8d6e77f — the real 5-line transcript. */
const tiffany44: ClipAskRecord = {
  durationSeconds: 44.24,
  analysisState: 'done',
  transcriptStatus: 'done',
  transcript:
    '[0:00] her entire life.\n[0:11] You know I love that girl.\n[0:30] I think she farts.\n[0:35] I love her so much.\n[0:38] I love that.',
};

describe('Ask never invents a speaker role', () => {
  it('spots the role a question presumes', () => {
    assert.equal(presumedSpeakerRole('What did the homeowner say?'), 'homeowner');
    assert.equal(presumedSpeakerRole('What did the home owner mention about the tile?'), 'homeowner');
    assert.equal(presumedSpeakerRole('Did the tech tell them about the filter?'), 'technician');
    assert.equal(presumedSpeakerRole('What was said in this clip?'), null);
    assert.equal(presumedSpeakerRole('What did the crew do?'), null);
  });

  it('labels the speaker unknown when the transcript cannot establish the homeowner', () => {
    const answer = groundedAnswerFromClip('What did the homeowner say?', tiffany44);
    assert.match(answer, /doesn't identify who is speaking/);
    assert.match(answer, /unknown speaker/);
    // Verbatim quotes with timestamps stay.
    assert.match(answer, /“You know I love that girl\.” .*\[0:11\]/);
    assert.doesNotMatch(answer, /the homeowner said/i);
  });

  it('answers the neutral preset with verbatim timestamped quotes and no caveat', () => {
    const answer = groundedAnswerFromClip('What was said in this clip?', tiffany44);
    assert.match(answer, /5 lines/);
    assert.match(answer, /\[0:00\].*\[0:11\].*\[0:30\].*\[0:35\].*\[0:38\]/s);
    assert.doesNotMatch(answer, /homeowner|unknown speaker/i);
  });

  it('says QuickBooks is not in this clip rather than borrowing another clip', () => {
    const answer = groundedAnswerFromClip('What was said about QuickBooks, and when?', tiffany44);
    assert.match(answer, /never mentions “QuickBooks”/);
  });

  it('keeps a role that is proven by an identified speaker', () => {
    const proven: ClipAskRecord = {
      ...tiffany44,
      peopleSpeakers: [
        { speakerLabel: 'Speaker 1', personId: 'p1', turnCount: 5, identityMethod: 'roster', serviceTitle: 'Homeowner' },
      ],
    };
    assert.equal(speakerRoleEstablished(proven, 'homeowner'), true);
    assert.doesNotMatch(groundedAnswerFromClip('What did the homeowner say?', proven), /unknown speaker/);
    const guessed: ClipAskRecord = {
      ...tiffany44,
      peopleSpeakers: [
        { speakerLabel: 'Speaker 1', personId: 'p1', turnCount: 5, identityMethod: 'unknown', serviceTitle: 'Homeowner' },
      ],
    };
    assert.equal(speakerRoleEstablished(guessed, 'homeowner'), false);
  });
});

test('summary turn labels and guessed roles do not establish a speaker (Bugbot #587)', async () => {
  const { withUnprovenSpeakerCaveat } = await import('../src/shared/clipAsk.ts');
  const out = withUnprovenSpeakerCaveat(
    'What did the homeowner say?',
    {
      conversationTurns: [{ tSec: 1, text: 'x', speakerLabel: 'Homeowner' }],
      peoplePresent: [{ label: 'Person', role: 'homeowner', speakerLabel: 'Speaker 1' }],
    } as never,
    '“x” [0:01]',
  );
  assert.match(out, /unknown speaker/);
});

test('paraphrased role attributions are neutralized, not only quoted ones', async () => {
  const { withUnprovenSpeakerCaveat } = await import('../src/shared/clipAsk.ts');
  const out = withUnprovenSpeakerCaveat(
    'What did the homeowner say?',
    {} as never,
    'The homeowner asked that the skylights be left alone.',
  );
  assert.match(out, /^The recording doesn't identify who is speaking/);
  assert.match(out, /An unknown speaker asked that the skylights be left alone\./);
  assert.doesNotMatch(out, /The homeowner asked/);
});

test('a role as the topic is not a presumed speaker', async () => {
  const { presumedSpeakerRole } = await import('../src/shared/clipAsk.ts');
  assert.equal(presumedSpeakerRole('What was said about the homeowner?'), null);
  assert.equal(presumedSpeakerRole('What did they say to the homeowner?'), null);
  assert.equal(presumedSpeakerRole('What did the adjuster ask about the roof?'), 'adjuster');
});
