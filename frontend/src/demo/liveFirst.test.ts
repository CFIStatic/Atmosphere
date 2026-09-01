import { describe, expect, it } from 'vitest';
import { isLiveFirstPath } from './liveFirst';

describe('isLiveFirstPath', () => {
  it('lets Settings and session restore hit the live account', () => {
    expect(isLiveFirstPath('/api/auth/me')).toBe(true);
    expect(isLiveFirstPath('/api/auth/login')).toBe(true);
    expect(isLiveFirstPath('/api/profile')).toBe(true);
    expect(isLiveFirstPath('/api/profile/avatar')).toBe(true);
    expect(isLiveFirstPath('/api/org/me')).toBe(true);
    expect(isLiveFirstPath('/api/org/members')).toBe(true);
  });

  it('lets the Dashboard library and job record hit the live org', () => {
    expect(isLiveFirstPath('/api/evidence-portal/library')).toBe(true);
    expect(isLiveFirstPath('/api/evidence-portal/evidence/abc-123/ask')).toBe(true);
    expect(isLiveFirstPath('/api/jobs')).toBe(true);
    expect(isLiveFirstPath('/api/jobs/abc-123')).toBe(true);
    expect(isLiveFirstPath('/api/operations/shared')).toBe(true);
    expect(isLiveFirstPath('/api/operations/proofs/pulse')).toBe(true);
    expect(isLiveFirstPath('/api/operations/shared/abc-123')).toBe(true);
    expect(isLiveFirstPath('/api/operations/shared/abc-123/proof')).toBe(true);
    expect(isLiveFirstPath('/api/operations/shared/abc-123/duplicate')).toBe(true);
  });

  it('leaves unrelated demo fixtures in place', () => {
    expect(isLiveFirstPath('/api/jobs/abc-123/memory')).toBe(false);
    expect(isLiveFirstPath('/api/billing/catalog')).toBe(false);
    expect(isLiveFirstPath('/api/operations/shared/abc/messages')).toBe(false);
  });
});
