import { describe, expect, it } from 'vitest';
import {
  TIFFANY_JOB_ID,
  tiffanyAccess,
  tiffanyCustody,
  tiffanyLive,
  tiffanyMembers,
  tiffanyMemory,
  tiffanyPosters,
  tiffanyProofs,
  tiffanyRecord,
  tiffanyScopeDoc,
  tiffanyShares,
} from './tiffanyJobFixture';
import {
  buildJobTimeline,
  ctDayKey,
  filterTimeline,
  formatCtTime,
  groupTimelineDays,
  initialJobFileSection,
  orderTimeline,
  publicFinding,
  timelineRedirectSearch,
  timelineSeekTarget,
  type TimelineSource,
} from './jobTimeline';

function tiffanySource(overrides: Partial<TimelineSource> = {}): TimelineSource {
  return {
    jobId: TIFFANY_JOB_ID,
    record: tiffanyRecord,
    proofs: tiffanyProofs,
    memory: tiffanyMemory,
    custody: tiffanyCustody,
    shares: tiffanyShares,
    access: tiffanyAccess,
    scopeDoc: tiffanyScopeDoc,
    liveSessions: tiffanyLive,
    posters: tiffanyPosters,
    members: tiffanyMembers,
    ...overrides,
  };
}

function joined(source: TimelineSource = tiffanySource()): string {
  return buildJobTimeline(source)
    .map((event) => event.sentence)
    .join('\n');
}

describe('job timeline', () => {
  it('prints Central Time and the dining-room clip in plain English', () => {
    expect(formatCtTime('2026-09-17T16:37:28.774Z')).toBe('11:37 AM CT');
    expect(ctDayKey('2026-09-17T16:37:28.774Z')).toBe('2026-09-17');
    const text = joined();
    expect(text).toContain('El Presidente recorded a clip lasting 34 seconds in the dining room.');
    expect(text).toContain('El Presidente opened job #12 — Project Tiffany & Co.');
    expect(text).toContain(
      'El Presidente renamed the job from Tiffany walkthrough to Project Tiffany & Co.',
    );
    expect(text).toContain('El Presidente is recording.');
    expect(text).toContain("Analysis is still reading El Presidente's clip in the dining room.");
  });

  it('does not invent events, notes, or private text', () => {
    expect(
      buildJobTimeline({
        jobId: TIFFANY_JOB_ID,
        record: null,
        proofs: null,
        memory: [],
        custody: null,
        shares: [],
        access: [],
        scopeDoc: null,
        liveSessions: [],
        posters: [],
        members: [],
      }),
    ).toEqual([]);

    const text = joined();
    expect(text).not.toMatch(/4412/);
    expect(text).not.toMatch(/toddler/i);
    expect(text).not.toMatch(/entire life/i);
    expect(text).not.toMatch(/lockbox/i);
    expect(text).not.toMatch(/\bnotes?\b/i);
    expect(text).not.toMatch(/\[(?:child )?privacy redacted\]/i);
    expect(publicFinding('A toddler said hello in the hallway.', true)).toBeNull();
    expect(publicFinding('A toddler said hello in the hallway.', false)).toBeNull();
    expect(tiffanyRecord.messages.some((message) => /4412/.test(message.body))).toBe(true);
  });

  it('keeps other jobs out and describes a duplicate from the new file only', () => {
    const events = buildJobTimeline(
      tiffanySource({
        memory: [
          ...tiffanyMemory,
          {
            ...tiffanyMemory[0]!,
            id: 'other-job',
            jobId: '11111111-1111-4111-8111-111111111111',
            summary: 'opened job #99 — Someone else',
          },
          {
            ...tiffanyMemory[0]!,
            id: 'mem-copy',
            seq: 40,
            summary: 'opened job #40 — Copy of Project Tiffany & Co.',
            snapshot: { title: 'Copy of Project Tiffany & Co.' },
            occurredAt: '2026-09-22T15:00:00.000Z',
          },
        ],
      }),
    );
    const text = events.map((event) => event.sentence).join('\n');
    expect(text).not.toContain('Someone else');
    expect(text).toContain('El Presidente duplicated the job file as Copy of Project Tiffany & Co.');
  });

  it('pins live rows and can flip the rest oldest-first', () => {
    const events = buildJobTimeline(tiffanySource());
    const newest = orderTimeline(events, false);
    const oldest = orderTimeline(events, true);
    expect(newest.live.every((event) => event.live)).toBe(true);
    expect(newest.live.map((event) => event.id)).toEqual(oldest.live.map((event) => event.id));
    expect(Date.parse(newest.live[0]!.at)).toBeGreaterThan(Date.parse(newest.live[1]!.at));
    expect(Date.parse(newest.rest[0]!.at)).toBeGreaterThan(Date.parse(newest.rest.at(-1)!.at));
    expect(Date.parse(oldest.rest[0]!.at)).toBeLessThan(Date.parse(oldest.rest.at(-1)!.at));
    const days = groupTimelineDays(newest.rest);
    expect(days[0]?.key).toBe('2026-09-21');
    expect(days.at(-1)?.key).toBe('2026-09-17');
    expect(filterTimeline(events, 'clip', 'El Presidente').every((event) => event.kind === 'clip')).toBe(
      true,
    );
  });

  it('does not seek into a redacted range', () => {
    const [clip] = buildJobTimeline(tiffanySource()).filter((event) => event.id === `clip:${tiffanyProofs.videos?.[0]?.id}`);
    expect(clip).toBeTruthy();
    expect(timelineSeekTarget({ ...clip!, seekSeconds: 12 })).toBeNull();
    expect(timelineSeekTarget({ ...clip!, seekSeconds: 2 })).toBe(2);
  });

  it('sends legacy job-file links to Timeline and leaves Ask alone', () => {
    expect(timelineRedirectSearch('?job=abc&section=happening&ask=1', '')).toBe(
      '?job=abc&section=timeline',
    );
    expect(timelineRedirectSearch('?job=abc&tab=job_history', '')).toBe('?job=abc&section=timeline');
    expect(timelineRedirectSearch('?job=abc', '#job-history')).toBe('?job=abc&section=timeline');
    expect(timelineRedirectSearch('?job=abc&section=happening-now', '')).toBe(
      '?job=abc&section=timeline',
    );
    expect(timelineRedirectSearch('?job=abc&ask=1', '')).toBeNull();
    expect(timelineRedirectSearch('?job=abc&section=timeline', '')).toBeNull();
    expect(initialJobFileSection('?section=happening', '')).toBe('timeline');
    expect(initialJobFileSection('?section=timeline', '')).toBe('timeline');
    expect(initialJobFileSection('?ask=1', '')).toBe('chat');
  });
});
