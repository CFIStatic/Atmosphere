import { afterEach, describe, expect, it } from 'vitest';
import { postAuthDestination } from './postAuth';

describe('postAuthDestination', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fieldEmbed;
  });

  it('returns the fallback when the user has an org', () => {
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/usage')).toBe('/usage');
  });

  it('preserves the intended destination through signup setup', () => {
    expect(postAuthDestination(null, '/usage')).toBe('/signup?step=2&next=%2Fusage');
  });

  it('keeps the Field Capture phone embed after sign-in', () => {
    document.documentElement.dataset.fieldEmbed = '1';
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/verifier-library')).toBe(
      '/verifier-library?embed=field',
    );
  });

  it('does not send a Field Capture session to workspace setup', () => {
    document.documentElement.dataset.fieldEmbed = '1';
    expect(postAuthDestination(null, '/verifier-library')).toBe('/verifier-library?embed=field');
  });
});
