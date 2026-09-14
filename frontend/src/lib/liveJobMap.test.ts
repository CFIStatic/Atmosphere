import { describe, expect, it } from 'vitest';
import { ACTIVITY_LABEL, projectPins, type LiveMapJob } from './liveJobMap';

function job(over: Partial<LiveMapJob> & Pick<LiveMapJob, 'jobId' | 'title'>): LiveMapJob {
  return {
    jobNumber: 1,
    status: 'in_progress',
    address: null,
    activity: 'idle',
    coords: null,
    lastPingAt: null,
    lastPingLabel: null,
    people: [],
    openSafetyFlags: [],
    filmedToday: false,
    ...over,
  };
}

describe('projectPins', () => {
  it('returns empty when nothing has coordinates', () => {
    expect(projectPins([job({ jobId: 'a', title: 'A' })])).toEqual([]);
  });

  it('places a northern point above a southern one', () => {
    const pins = projectPins([
      job({
        jobId: 'north',
        title: 'North',
        coords: { lat: 31, lon: -97, source: 'property' },
      }),
      job({
        jobId: 'south',
        title: 'South',
        coords: { lat: 29, lon: -97, source: 'property' },
      }),
    ]);
    const north = pins.find((p) => p.job.jobId === 'north')!;
    const south = pins.find((p) => p.job.jobId === 'south')!;
    expect(north.y).toBeLessThan(south.y);
  });
});

describe('ACTIVITY_LABEL', () => {
  it('labels on_site for the office', () => {
    expect(ACTIVITY_LABEL.on_site).toBe('On site');
  });
});
