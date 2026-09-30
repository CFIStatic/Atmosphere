import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatViewerTime, setViewerTimeZoneForTests, viewerDayKey } from '../../lib/viewerTime';
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
  filterTimeline,
  groupTimelineDays,
  initialJobFileSection,
  orderTimeline,
  publicFinding,
  packetTimelineLocation,
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
  beforeAll(() => setViewerTimeZoneForTests('America/Chicago'));
  afterAll(() => setViewerTimeZoneForTests(null));

  it('prints Central Time and the dining-room clip in plain English', () => {
    expect(formatViewerTime('2026-09-17T16:37:28.774Z')).toBe('11:37 AM CT');
    expect(viewerDayKey('2026-09-17T16:37:28.774Z')).toBe('2026-09-17');
    const text = joined();
    expect(text).toContain('El Presidente recorded a clip lasting 34 seconds in the dining room.');
    expect(text).toContain('El Presidente opened job #12 — Project Tiffany & Co.');
    expect(text).toContain(
      'El Presidente renamed the job from Tiffany walkthrough to Project Tiffany & Co.',
    );
    expect(text).toContain('El Presidente is recording.');
    expect(text).toContain(
      "Analysis is still reading El Presidente's clip in the dining room — Transcribing",
    );
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
    expect(timelineRedirectSearch('?job=abc&section=packet', '')).toBe('?job=abc&section=timeline');
    expect(timelineRedirectSearch('?job=abc&section=claim-ready&ask=1', '')).toBe(
      '?job=abc&section=timeline',
    );
    expect(timelineRedirectSearch('?job=abc', '#packet')).toBe('?job=abc&section=timeline');
    expect(initialJobFileSection('?section=happening', '')).toBe('timeline');
    expect(initialJobFileSection('?section=packet', '')).toBe('timeline');
    expect(initialJobFileSection('?section=claim_ready', '')).toBe('timeline');
    expect(initialJobFileSection('?section=timeline', '')).toBe('timeline');
    expect(initialJobFileSection('?ask=1', '')).toBe('chat');
    expect(packetTimelineLocation('job-1', '/jobs/job-1/packet', '')).toBe(
      '/job-progress?job=job-1&section=timeline',
    );
    expect(packetTimelineLocation('job-1', '/jobs/job-1', '?section=claim-ready')).toBe(
      '/job-progress?section=timeline&job=job-1',
    );
    expect(packetTimelineLocation('job-1', '/jobs/job-1', '')).toBeNull();
  });

  it('shows one finished-reading line per clip and labels a later run', () => {
    const base = tiffanyCustody.clips[0]!;
    const clip = (id: string, times: string[]) => ({
      ...base,
      clip: { ...base.clip, id },
      chainOfCustody: times.map((at) => ({
        action: 'analysed',
        by: 'Analysis',
        role: null,
        detail: null,
        at,
      })),
    });
    const source = tiffanySource({
      proofs: { ...tiffanyProofs, videos: [], days: [] },
      liveSessions: [],
      custody: {
        ...tiffanyCustody,
        clips: [
          clip('clip-a', ['2026-09-21T18:00:00.000Z', '2026-09-21T18:02:00.000Z']),
          clip('clip-b', ['2026-09-21T18:05:00.000Z', '2026-09-21T18:06:00.000Z']),
          clip('clip-c', ['2026-09-21T18:10:00.000Z', '2026-09-21T18:11:00.000Z', '2026-09-21T20:00:00.000Z']),
        ],
      },
    });
    const reading = buildJobTimeline(source)
      .map((event) => event.sentence)
      .filter((sentence) => /finished reading|re-analyzed|still reading/.test(sentence));
    expect(reading.filter((sentence) => sentence.startsWith('Analysis finished reading'))).toHaveLength(3);
    expect(reading.filter((sentence) => sentence.includes('re-analyzed'))).toEqual([
      'Analysis re-analyzed the clip.',
    ]);
    expect(reading).toHaveLength(4);
  });

  it('does not say a clip finished reading while its summary is still processing', () => {
    const base = tiffanyCustody.clips[0]!;
    const id = 'clip-summary';
    const source = tiffanySource({
      proofs: {
        ...tiffanyProofs,
        videos: [
          {
            id,
            partyId: 'party-el',
            company: 'Atmosphere',
            workDate: '2026-09-21',
            phase: 'before',
            durationSeconds: 10,
            capturedAt: '2026-09-21T18:00:00.000Z',
            receivedAt: '2026-09-21T18:01:00.000Z',
            analysisStatus: 'done',
            narrationStatus: 'done',
            transcriptStatus: 'done',
            transcriptError: null,
            aiSummary: null,
            heardOnMic: null,
            conversation: { summaryState: 'updating' },
          },
        ],
        days: [],
      },
      liveSessions: [],
      custody: {
        ...tiffanyCustody,
        clips: [
          {
            ...base,
            clip: { ...base.clip, id },
            chainOfCustody: [
              { action: 'analysed', by: 'Analysis', role: null, detail: null, at: '2026-09-21T18:05:00.000Z' },
            ],
          },
        ],
      },
    });
    const reading = buildJobTimeline(source)
      .map((event) => event.sentence)
      .filter((sentence) => /reading|Analyzed|processing/i.test(sentence));
    expect(reading.join('\n')).toContain('Summary still processing');
    expect(reading.join('\n')).not.toContain('finished reading');
    expect(reading.filter((sentence) => /still reading/i.test(sentence))).toHaveLength(1);
  });

  it('does not say a silent clip finished reading when its summary failed', () => {
    const base = tiffanyCustody.clips[0]!;
    const id = 'clip-silent-summary';
    const source = tiffanySource({
      proofs: {
        ...tiffanyProofs,
        videos: [
          {
            id,
            partyId: 'party-el',
            company: 'Atmosphere',
            workDate: '2026-09-21',
            phase: 'before',
            durationSeconds: 10,
            capturedAt: '2026-09-21T18:00:00.000Z',
            receivedAt: '2026-09-21T18:01:00.000Z',
            analysisStatus: 'done',
            narrationStatus: 'done',
            transcriptStatus: 'skipped',
            transcriptError: null,
            aiSummary: null,
            heardOnMic: null,
            conversation: null,
            summaryState: 'failed',
            hasSummary: false,
            noSpeech: true,
          },
        ],
        days: [],
      },
      liveSessions: [],
      custody: {
        ...tiffanyCustody,
        clips: [
          {
            ...base,
            clip: { ...base.clip, id },
            chainOfCustody: [
              { action: 'analysed', by: 'Analysis', role: null, detail: null, at: '2026-09-21T18:05:00.000Z' },
            ],
          },
        ],
      },
    });
    const reading = buildJobTimeline(source)
      .map((event) => event.sentence)
      .filter((sentence) => /reading|Analyzed|unavailable/i.test(sentence));
    expect(reading.join('\n')).toContain('Summary unavailable');
    expect(reading.join('\n')).not.toContain('finished reading');
  });

  it('keeps evidence-report exports and leaves claim packets out', () => {
    const text = joined();
    expect(text).toContain('El Presidente exported the evidence report (proof-pack.pdf · full job)');
    expect(text).not.toMatch(/packet/i);

    const clip = tiffanyCustody.clips[0]!;
    const withClaim = tiffanySource({
      custody: {
        ...tiffanyCustody,
        clips: [
          {
            ...clip,
            chainOfCustody: [
              ...clip.chainOfCustody,
              {
                action: 'exported',
                by: 'El Presidente',
                role: 'global_admin',
                detail: 'claim packet',
                at: '2026-09-20T20:00:00.000Z',
              },
            ],
          },
          ...tiffanyCustody.clips.slice(1),
        ],
      },
    });
    const claimText = buildJobTimeline(withClaim)
      .map((event) => event.sentence)
      .join('\n');
    expect(claimText).not.toMatch(/packet/i);
    expect(claimText).toContain('exported the evidence report');
  });
});
