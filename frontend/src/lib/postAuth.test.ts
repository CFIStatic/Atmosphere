import { describe, expect, it } from 'vitest';
import { homeForMembership, postAuthDestination } from './postAuth';

describe('postAuthDestination', () => {
  it('returns the fallback when the user has an org', () => {
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/usage')).toBe('/usage');
  });

  it('preserves the intended destination through signup setup', () => {
    expect(postAuthDestination(null, '/usage')).toBe('/signup?step=2&next=%2Fusage');
  });

  it('lands a field technician on My work from the office home', () => {
    expect(
      homeForMembership(
        { role: 'field_technician', org: { id: 'o' } } as never,
        '/verifier-library',
      ),
    ).toBe('/my-work');
    expect(postAuthDestination({ role: 'field_technician' } as never, '/field')).toBe('/my-work');
  });

  it('does not steal a technician who asked for a specific page', () => {
    expect(postAuthDestination({ role: 'field_technician' } as never, '/jobs/abc')).toBe(
      '/jobs/abc',
    );
  });

  it('keeps office roles on the dashboard they asked for', () => {
    expect(postAuthDestination({ role: 'project_manager' } as never, '/verifier-library')).toBe(
      '/verifier-library',
    );
  });
});
