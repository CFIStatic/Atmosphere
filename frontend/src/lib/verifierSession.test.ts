import { describe, expect, it } from 'vitest';
import { verifierSessionUser } from './verifierSession';

describe('verifierSessionUser', () => {
  it('carries the saved name, company, and photo into the office rail', () => {
    expect(
      verifierSessionUser({
        email: 'jack@jettx.ai',
        fullName: 'Jack Cyganiak',
        avatarUrl: 'https://img.example/jack.jpg',
        orgName: 'Jettx LLC',
        role: 'project_manager',
        roleLabel: 'Project manager',
      }),
    ).toEqual({
      name: 'Jack Cyganiak',
      email: 'jack@jettx.ai',
      initials: 'JC',
      avatarUrl: 'https://img.example/jack.jpg',
      orgName: 'Jettx LLC',
      role: 'project_manager',
      roleLabel: 'Project manager',
    });
  });

  it('falls back to auth metadata when the profile row has not caught up', () => {
    const user = verifierSessionUser({
      email: 'jack@jettx.ai',
      metadata: { full_name: 'Jack Cyganiak' },
      orgName: 'Jettx LLC',
    });
    expect(user.name).toBe('Jack Cyganiak');
    expect(user.initials).toBe('JC');
    expect(user.avatarUrl).toBeUndefined();
  });

  it('rejects a non-image URL so the rail keeps initials', () => {
    expect(
      verifierSessionUser({
        email: 'jack@jettx.ai',
        fullName: 'Jack Cyganiak',
        avatarUrl: 'javascript:alert(1)',
      }).avatarUrl,
    ).toBeNull();
  });
});
