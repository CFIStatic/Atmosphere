import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, PLATFORM_HOME, PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
  it('opens the office on Overview (the library), not a Dashboard label', () => {
    expect(PLATFORM_HOME.operations).toBe('/verifier-library');
    expect(DASHBOARD_HOME).toBe('/verifier-library');
    const work = PLATFORMS.operations.groups.find((group) => group.label === 'Work');
    expect(work).toBeDefined();
    expect(work!.items.map((item) => [item.to, item.label])).toEqual([
      ['/verifier-library', 'Overview'],
      ['/intake', 'Start a job'],
      ['/field', 'Field'],
      ['/jobs', 'My jobs'],
    ]);
    expect(work!.items.map((item) => item.label)).not.toContain('Dashboard');
  });
});
