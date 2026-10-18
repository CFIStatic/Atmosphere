import { describe, expect, it } from 'vitest';
import { clipDisplayTitle } from '../../lib/jobVideoRows';
import type { LibraryClipMeta } from '../../lib/jobVideoRows';
import { dateSearchTokens } from '../../lib/jobFileAsk';

describe('clip titles', () => {
  it('turns a cut-off description into "Room walk-through · Oct 8"', () => {
    expect(
      clipDisplayTitle(
        { id: 'p1', workDate: '2026-10-08', rooms: [{ roomName: 'kitchen' }] },
        { title: 'Short, Handheld Clip Filmed Inside a Home, Likely' } as LibraryClipMeta,
      ),
    ).toBe('Kitchen walk-through · Oct 8');
  });
});

describe('Ask date tokens', () => {
  it('keeps a bare work date as-is', () => {
    const tokens = dateSearchTokens('2026-10-08');
    expect(tokens[0]).toBe('2026-10-08');
    expect(tokens.some((t) => /oct 8$/i.test(t))).toBe(true);
  });
});
