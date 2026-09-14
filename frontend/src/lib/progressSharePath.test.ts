import { describe, expect, it } from 'vitest';
import { progressShareApiPath } from './progressSharePath';

describe('progressShareApiPath', () => {
  it('encodes a path token and optional action', () => {
    expect(progressShareApiPath('tok-1')).toBe('/api/progress-share/tok-1');
    expect(progressShareApiPath('tok-1', '/ask')).toBe('/api/progress-share/tok-1/ask');
    expect(progressShareApiPath('a/b', 'ask')).toBe('/api/progress-share/a%2Fb/ask');
  });

  it('uses /session when the token has already left the URL', () => {
    expect(progressShareApiPath('')).toBe('/api/progress-share/session');
    expect(progressShareApiPath('   ')).toBe('/api/progress-share/session');
    expect(progressShareApiPath('', '/ask')).toBe('/api/progress-share/session/ask');
    expect(progressShareApiPath('', `/proof/${encodeURIComponent('p-1')}/video`)).toBe(
      '/api/progress-share/session/proof/p-1/video',
    );
  });
});
