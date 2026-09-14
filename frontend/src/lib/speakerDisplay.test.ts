import { describe, expect, it } from 'vitest';
import { overlaySpeakerDisplayName, speakerDisplayName } from './speakerDisplay';
import type { ProofPeoplePresent } from './api';

const people: ProofPeoplePresent = {
  peoplePresent: [
    {
      id: 'person-1',
      label: 'Lex Fridman',
      role: 'other',
      appearance: null,
      appearMoments: [],
      speakerLabel: 'Speaker A',
      displayName: 'Lex Fridman',
      identityMethod: 'web',
      identityConfidence: 0.93,
    },
  ],
  peopleSpeakers: [
    {
      speakerLabel: 'Speaker A',
      personId: 'person-1',
      turnCount: 3,
      displayName: 'Lex Fridman',
      identityMethod: 'web',
      identityConfidence: 0.93,
    },
  ],
};

describe('speakerDisplayName', () => {
  it('returns displayName when known and keeps Speaker N otherwise', () => {
    expect(speakerDisplayName('Speaker A', people)).toBe('Lex Fridman');
    expect(speakerDisplayName('Speaker B', people)).toBe('Speaker B');
    expect(speakerDisplayName('Speaker A', null)).toBe('Speaker A');
  });

  it('overlays names onto transcript rows for UI', () => {
    const rows = overlaySpeakerDisplayName(
      [
        { tSec: 1, text: 'Hello', speakerLabel: 'Speaker A' },
        { tSec: 2, text: 'Hi', speakerLabel: 'Speaker B' },
      ],
      people,
    );
    expect(rows[0]?.speakerLabel).toBe('Lex Fridman');
    expect(rows[1]?.speakerLabel).toBe('Speaker B');
  });
});
