import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, PLATFORM_HOME, PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
  it('opens the office on Overview, not the All videos library', () => {
    expect(PLATFORM_HOME.operations).toBe('/field');
    expect(PLATFORM_HOME.field).toBe('/field');
    expect(DASHBOARD_HOME).toBe('/field');
  });

  it('puts Overview above Start a job and My jobs under Dashboard', () => {
    const work = PLATFORMS.operations.groups.find((group) => group.label === 'Work');
    expect(work).toBeDefined();
    expect(work!.items.map((item) => [item.to, item.label])).toEqual([
      ['/field', 'Overview'],
      ['/intake', 'Start a job'],
      ['/verifier-library', 'Dashboard'],
      ['/jobs', 'My jobs'],
    ]);
  });

  it('does not offer a Capture tab', () => {
    const labels = Object.values(PLATFORMS).flatMap((platform) =>
      platform.groups.flatMap((group) => group.items.map((item) => item.label)),
    );
    expect(labels).not.toContain('Capture');
    expect(labels).not.toContain('Field capture');
    expect(labels).not.toContain('Field');
  });
});
