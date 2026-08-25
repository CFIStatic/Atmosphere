import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, PLATFORM_HOME, PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
  it('uses Overview for the library and never labels it Dashboard', () => {
    expect(PLATFORM_HOME.operations).toBe('/verifier-library');
    expect(DASHBOARD_HOME).toBe('/verifier-library');
    const work = PLATFORMS.operations.groups.find((group) => group.label === 'Work');
    expect(work!.items.map((item) => [item.to, item.label])).toEqual([
      ['/verifier-library', 'Overview'],
      ['/intake', 'Start a job'],
      ['/field', 'Field'],
      ['/jobs', 'My jobs'],
    ]);
    expect(work!.items.map((item) => item.label)).not.toContain('Dashboard');
  });
});
