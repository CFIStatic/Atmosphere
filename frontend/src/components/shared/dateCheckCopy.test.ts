import { describe, expect, it } from 'vitest';
import { displayRoomName, integrityNotice, mergeRoomsByName } from './proofIntegrityCopy';
import { clipDisplayTitle } from '../../lib/jobVideoRows';
import type { ProofJobRoom } from '../../lib/api';
import type { LibraryClipMeta } from '../../lib/jobVideoRows';
import { dateSearchTokens } from '../../lib/jobFileAsk';

describe('date check copy', () => {
  it('never says "failed"; names a date mismatch plainly', () => {
    expect(integrityNotice({ contradicted: 0 })).toBeNull();
    expect(integrityNotice({ contradicted: 1, dateMismatches: 1 })).toBe('1 clip has a date mismatch');
    expect(integrityNotice({ contradicted: 2, dateMismatches: 2 })).toBe('2 clips have a date mismatch');
    expect(integrityNotice({ contradicted: 2, dateMismatches: 1 })).toBe('2 clips need a look');
  });
});

describe('room names', () => {
  it('title-cases and drops underscores', () => {
    expect(displayRoomName('living_room')).toBe('Living Room');
    expect(displayRoomName('living room')).toBe('Living Room');
  });
  it('merges spelling variants into one room', () => {
    const base = { traits: [], datesWorked: [], sightings: [] };
    const merged = mergeRoomsByName([
      { ...base, roomKey: 'a', roomName: 'living room', firstSeen: '2026-10-08', lastSeen: '2026-10-08' },
      { ...base, roomKey: 'b', roomName: 'living_room', firstSeen: '2026-10-07', lastSeen: '2026-10-09' },
    ] as ProofJobRoom[]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.roomName).toBe('Living Room');
    expect(merged[0]!.firstSeen).toBe('2026-10-07');
    expect(merged[0]!.lastSeen).toBe('2026-10-09');
  });
});

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
