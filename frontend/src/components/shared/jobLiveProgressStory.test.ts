import { describe, expect, it } from 'vitest';
import type { ProofVideoRecord } from '../../lib/api';
import {
  buildHomeownerLiveProgressStory,
  liveStoryHasContent,
} from './jobLiveProgressStory';

function video(
  partial: Partial<ProofVideoRecord> & Pick<ProofVideoRecord, 'id' | 'workDate'>,
): ProofVideoRecord {
  return {
    partyId: 'p1',
    company: 'Crew Co',
    phase: 'after',
    durationSeconds: 120,
    analysisStatus: 'done',
    narrationStatus: null,
    transcriptStatus: null,
    transcriptError: null,
    aiSummary: null,
    heardOnMic: null,
    conversation: null,
    people: null,
    privacyRedactions: null,
    ...partial,
  };
}

describe('buildHomeownerLiveProgressStory', () => {
  it('builds a chronological Glance timeline across clips', () => {
    const story = buildHomeownerLiveProgressStory([
      video({
        id: 'a',
        workDate: '2026-09-12',
        company: 'Delgado Roofing',
        conversation: {
          conversationExecutiveSummary: 'Crew finished the north slope tear-off.',
          conversationKeyMoments: [{ tSec: 12, label: 'Decision', text: 'Agreed to tarp overnight' }],
          conversationActionItems: [{ text: 'Order ice-and-water shield', owner: 'PM' }],
        },
        people: {
          peoplePresent: [{ id: '1', label: 'Alex', role: 'crew', appearance: null, appearMoments: [] }],
        },
      }),
      video({
        id: 'b',
        workDate: '2026-09-13',
        company: 'Delgado Roofing',
        conversation: {
          conversationSummary: 'Installed underlayment before the rain.',
        },
      }),
    ]);

    expect(story.moments).toHaveLength(2);
    expect(story.moments[0].glance).toMatch(/north slope/i);
    expect(story.moments[0].scan.some((p) => /tarp/i.test(p))).toBe(true);
    expect(story.moments[0].people).toContain('Alex');
    expect(story.overview).toMatch(/north slope/i);
    expect(story.overview).toMatch(/underlayment|rain/i);
    expect(liveStoryHasContent(story)).toBe(true);
  });

  it('omits private-moment language and marks privacy-protected clips', () => {
    const story = buildHomeownerLiveProgressStory([
      video({
        id: 'priv',
        workDate: '2026-09-14',
        aiSummary: 'Worker walked into the bathroom while recording',
        conversation: {
          conversationSummary: 'Discussion in the bathroom about fixtures',
          conversationKeyMoments: [{ tSec: 20, label: 'Note', text: 'Standing in the bathroom stall' }],
        },
        privacyRedactions: {
          version: 1,
          ranges: [
            { startSec: 10, endSec: 40, reason: 'bathroom', confidence: 0.9, source: 'vision' },
          ],
        },
      }),
    ]);

    expect(JSON.stringify(story)).not.toMatch(/bathroom/i);
    expect(story.moments[0]?.privacyProtected).toBe(true);
    expect(story.moments[0]?.glance).toBeNull();
  });

  it('explains empty jobs without inventing work', () => {
    const empty = buildHomeownerLiveProgressStory([]);
    expect(empty.overview).toMatch(/No field clips/i);
    expect(liveStoryHasContent(empty)).toBe(false);

    const pending = buildHomeownerLiveProgressStory([
      video({ id: 'quiet', workDate: '2026-09-14', aiSummary: null, conversation: null }),
    ]);
    expect(pending.overview).toMatch(/Glance/i);
    expect(pending.moments).toHaveLength(0);
  });
});
