import { describe, expect, it } from 'vitest';
import { PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
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
