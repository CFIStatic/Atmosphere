import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, PLATFORM_HOME, PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
  it('opens the office on Overview, not the All videos library', () => {
    expect(PLATFORM_HOME.operations).toBe('/field');
    expect(PLATFORM_HOME.field).toBe('/field');
    expect(DASHBOARD_HOME).toBe('/field');
  });

  it('puts Overview, Start a job, Dashboard, and My jobs on the office rail', () => {
    const work = PLATFORMS.operations.groups.find((group) => group.label === 'Work');
    expect(work).toBeDefined();
    expect(work!.items.map((item) => [item.to, item.label])).toEqual([
      ['/field', 'Overview'],
      ['/intake', 'Start a job'],
      ['/verifier-library', 'Dashboard'],
      ['/jobs', 'My jobs'],
    ]);
    expect(work!.items.map((item) => item.label)).not.toContain('Field');
    expect(work!.items.map((item) => item.label)).not.toContain('Capture');
  });
});
