import { describe, expect, it } from 'vitest';
import { buildJobProgressStory, dayIsOnSite } from './jobProgressStory';
import type { JobScopeItem, ProofDay } from '../../lib/api';

function scope(partial: Partial<JobScopeItem> & Pick<JobScopeItem, 'id' | 'title' | 'state'>): JobScopeItem {
  return {
    party_id: null,
    detail: null,
    amount: null,
    reason: null,
    revision: 1,
    decided_at: null,
    created_at: '2026-08-01T00:00:00Z',
    ...partial,
  };
}

function day(partial: Partial<ProofDay> & Pick<ProofDay, 'partyId' | 'workDate'>): ProofDay {
  return {
    company: 'Crew Co',
    hasBefore: false,
    hasAfter: false,
    checks: [],
    contradicted: false,
    summary: 'Field update',
    payable: false,
    payableBecause: '',
    accepted: false,
    rejected: false,
    aiSummary: null,
    aiFindings: null,
    proofIds: [],
    ...partial,
  };
}

describe('buildJobProgressStory', () => {
  it('puts unused scope in What’s next and blockers in Happening now', () => {
    const story = buildJobProgressStory({
      scope: [
        scope({ id: '1', title: 'Extract standing water', state: 'included' }),
        scope({ id: '2', title: 'Set drying equipment', state: 'included' }),
        scope({ id: '3', title: 'Do not pull hardwood', state: 'excluded', reason: 'Still drying' }),
      ],
      days: [],
      risks: [
        {
          key: 'unacked',
          level: 'blocker',
          title: 'jack@jettx.ai has not accepted the scope',
          action: 'They have the link and have not confirmed. Do not let them start.',
        },
      ],
    });

    expect(story.happening.map((i) => i.title)).toEqual([
      'jack@jettx.ai has not accepted the scope',
    ]);
    expect(story.happened).toEqual([]);
    expect(story.next.map((i) => i.title)).toEqual([
      'Extract standing water',
      'Set drying equipment',
    ]);
    expect(story.doneCount).toBe(0);
    expect(story.trackedCount).toBe(2);
    expect(story.exclusionCount).toBe(1);
  });

  it('treats a before-only day as happening now', () => {
    const onSite = day({
      partyId: 'p1',
      workDate: '2026-08-12',
      hasBefore: true,
      hasAfter: false,
      summary: 'Morning clip in. Still on site.',
    });
    expect(dayIsOnSite(onSite)).toBe(true);

    const story = buildJobProgressStory({
      scope: [scope({ id: '1', title: 'Tear off north slope', state: 'included' })],
      days: [onSite],
      risks: [],
    });

    expect(story.happening.some((i) => i.kind === 'day' && i.badge === 'On site now')).toBe(true);
    expect(story.next.map((i) => i.title)).toEqual(['Tear off north slope']);
    expect(story.happened).toEqual([]);
  });

  it('files verified days and completed scope under What happened', () => {
    const story = buildJobProgressStory({
      scope: [
        scope({ id: '1', title: 'Tear off and replace roof', state: 'included' }),
        scope({ id: '2', title: 'Rewire bedroom circuits', state: 'included' }),
      ],
      days: [
        day({
          partyId: 'p2',
          company: 'Delgado Roofing',
          workDate: '2026-08-05',
          hasBefore: true,
          hasAfter: true,
          accepted: true,
          payable: true,
          summary: 'North slope stripped and underlayment down.',
          proofClips: [
            { id: 'pf-1', durationSeconds: 68 },
            { id: 'pf-2', durationSeconds: 94 },
          ],
          aiFindings: {
            scopeVerdicts: [
              {
                title: 'Tear off and replace roof',
                verdict: 'appears_complete',
                because: 'Slope stripped; new underlayment in frame.',
              },
            ],
          },
        }),
      ],
      risks: [],
    });

    expect(story.happened.some((i) => i.kind === 'day' && i.clock === '1:08 · 1:34')).toBe(true);
    expect(story.happened.some((i) => i.title === 'Tear off and replace roof' && i.badge === 'Done')).toBe(
      true,
    );
    expect(story.next.map((i) => i.title)).toEqual(['Rewire bedroom circuits']);
    expect(story.doneCount).toBe(1);
    expect(story.trackedCount).toBe(2);
  });

  it('treats a day film with analysis as work described, not waiting on an after', () => {
    const film = day({
      partyId: 'p3',
      workDate: '2026-08-17',
      hasBefore: false,
      hasAfter: true,
      aiSummary: 'Crew extracted standing water in the living room.',
      aiFindings: { kind: 'day_film', workPerformed: ['Extracted standing water'] },
    });
    const story = buildJobProgressStory({
      scope: [],
      days: [film],
      risks: [],
    });
    expect(story.happened.some((i) => i.badge === 'Work described')).toBe(true);
    expect(story.happening.some((i) => i.kind === 'day')).toBe(false);
  });

  it('surfaces proof-only scope when the record has no scope rows', () => {
    const story = buildJobProgressStory({
      scope: [],
      days: [
        day({
          partyId: 'p1',
          workDate: '2026-08-04',
          hasBefore: true,
          hasAfter: true,
          payable: true,
          aiFindings: {
            scopeVerdicts: [
              { title: 'Extract water', verdict: 'appears_complete', because: 'Floors are clear.' },
              { title: 'Set dehus', verdict: 'in_progress', because: 'Equipment still running.' },
              { title: 'Replace LVP', verdict: 'not_visible', because: 'Not in frame.' },
            ],
          },
        }),
      ],
      risks: [],
    });

    expect(story.happened.some((i) => i.title === 'Extract water')).toBe(true);
    expect(story.happening.some((i) => i.title === 'Set dehus')).toBe(true);
    expect(story.next.map((i) => i.title)).toEqual(['Replace LVP']);
  });
});
