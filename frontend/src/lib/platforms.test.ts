import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, PLATFORM_HOME, PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
  it('keeps sign-in on the Dashboard library', () => {
    expect(PLATFORM_HOME.operations).toBe('/verifier-library');
    expect(PLATFORM_HOME.field).toBe('/verifier-library');
    expect(DASHBOARD_HOME).toBe('/verifier-library');
  });

  it('puts Start a job and Dashboard on the office rail', () => {
    const work = PLATFORMS.operations.groups.find((group) => group.label === 'Work');
    expect(work).toBeDefined();
    expect(work!.items.map((item) => [item.to, item.label])).toEqual([
      ['/intake', 'Start a job'],
      ['/verifier-library', 'Dashboard'],
    ]);
    expect(work!.items.map((item) => item.label)).not.toContain('Overview');
    expect(work!.items.map((item) => item.label)).not.toContain('Job Files');
    expect(work!.items.map((item) => item.label)).not.toContain('My work');
    expect(PLATFORMS.field.groups.find((group) => group.label === 'Work')?.items).toEqual(work!.items);
    expect(work!.items.map((item) => item.label)).not.toContain('Field');
    expect(work!.items.map((item) => item.label)).not.toContain('Capture');
  });
});
