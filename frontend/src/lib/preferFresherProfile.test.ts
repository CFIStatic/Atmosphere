import { describe, expect, it } from 'vitest';
import type { Profile } from './api';
import { avatarCacheVersion, preferFresherProfile } from './preferFresherProfile';

function profile(partial: Partial<Profile>): Profile {
  return {
    id: 'user-1',
    email: 'jack@jettx.ai',
    fullName: 'Jack Cyganiak',
    avatarUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
    ...partial,
  };
}

describe('preferFresherProfile', () => {
  it('keeps a Settings save when a slower GET still has the old photo', () => {
    const saved = profile({
      avatarUrl: 'https://img.example/avatar.jpg?v=200',
      updatedAt: '2026-08-29T18:00:00Z',
    });
    const stale = profile({
      avatarUrl: 'https://img.example/avatar.jpg?v=100',
      updatedAt: '2026-08-22T00:00:00Z',
    });

    expect(preferFresherProfile(saved, stale)).toEqual(saved);
  });

  it('takes a newer GET after the user removes the photo', () => {
    const previous = profile({
      avatarUrl: 'https://img.example/avatar.jpg?v=200',
      updatedAt: '2026-08-22T00:00:00Z',
    });
    const removed = profile({
      avatarUrl: null,
      updatedAt: '2026-08-29T18:00:00Z',
    });

    expect(preferFresherProfile(previous, removed)).toEqual(removed);
  });

  it('keeps the newer cache-busted URL when timestamps match', () => {
    const current = profile({
      avatarUrl: 'https://img.example/avatar.jpg?v=300',
    });
    const incoming = profile({
      fullName: 'Jack C.',
      avatarUrl: 'https://img.example/avatar.jpg?v=100',
    });

    expect(preferFresherProfile(current, incoming)).toEqual({
      ...incoming,
      avatarUrl: current.avatarUrl,
    });
  });

  it('does not replace a saved profile with a failed GET', () => {
    const saved = profile({ avatarUrl: 'https://img.example/jack.jpg' });
    expect(preferFresherProfile(saved, null)).toEqual(saved);
  });
});

describe('avatarCacheVersion', () => {
  it('reads the v= token and treats a data URL as newest', () => {
    expect(avatarCacheVersion('https://img.example/avatar.jpg?v=1710000000000')).toBe(1710000000000);
    expect(avatarCacheVersion('data:image/png;base64,aaa')).toBe(Number.MAX_SAFE_INTEGER);
    expect(avatarCacheVersion(null)).toBe(0);
  });
});
