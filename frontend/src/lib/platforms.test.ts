import { describe, expect, it } from 'vitest';
import { PLATFORMS } from './platforms';

describe('operations rail destinations', () => {
  it('puts Field above Start a job and Jobs under Dashboard', () => {
    const work = PLATFORMS.operations.groups.find((group) => group.label === 'Work');
    expect(work).toBeDefined();
    expect(work!.items.map((item) => [item.to, item.label])).toEqual([
      ['/field', 'Field'],
      ['/intake', 'Start a job'],
      ['/verifier-library', 'Dashboard'],
      ['/jobs', 'Jobs'],
    ]);
  });
});
