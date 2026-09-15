import { describe, expect, it } from 'vitest';
import { isShareSurfacePath } from './shareSurfaceRobots';

describe('isShareSurfacePath', () => {
  it('flags progress, shared, and verifier/shared bearer surfaces', () => {
    expect(isShareSurfacePath('/progress')).toBe(true);
    expect(isShareSurfacePath('/progress/tok')).toBe(true);
    expect(isShareSurfacePath('/progress-view')).toBe(true);
    expect(isShareSurfacePath('/shared/tok')).toBe(true);
    expect(isShareSurfacePath('/verifier/shared/tok')).toBe(true);
  });

  it('flags /verifier/?share= tokens', () => {
    expect(isShareSurfacePath('/verifier/', '?share=abc')).toBe(true);
    expect(isShareSurfacePath('/verifier', 'share=abc')).toBe(true);
  });

  it('leaves ordinary office routes indexable', () => {
    expect(isShareSurfacePath('/')).toBe(false);
    expect(isShareSurfacePath('/jobs')).toBe(false);
    expect(isShareSurfacePath('/login')).toBe(false);
    expect(isShareSurfacePath('/verifier/')).toBe(false);
    expect(isShareSurfacePath('/verifier-library')).toBe(false);
  });
});
