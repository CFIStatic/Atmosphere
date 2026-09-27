import { describe, expect, it } from 'vitest';
import {
  expandMentionTokens,
  filterMentionMembers,
  mentionDisplayName,
  mentionQueryAt,
  nameMatchesQuery,
  splitMentionRuns,
  type MentionMember,
} from './mentions';

const john: MentionMember = {
  userId: '11111111-1111-4111-8111-111111111111',
  fullName: 'John Cyganiak',
  email: 'john.cyganiak@ortizrestoration.com',
};
const elena: MentionMember = {
  userId: 'u-elena',
  fullName: 'Elena Cruz',
  email: 'elena@ortizrestoration.com',
};
const smith: MentionMember = {
  userId: '44444444-4444-4444-8444-444444444444',
  fullName: 'John Smith',
  email: 'jsmith@ortizrestoration.com',
};

describe('mention parsing', () => {
  it('uses the profile name, then the login name', () => {
    expect(mentionDisplayName({ fullName: 'John Cyganiak', loginName: 'Other Person' })).toBe('John Cyganiak');
    expect(mentionDisplayName({ fullName: '  ', loginName: 'Jane Alvarez' })).toBe('Jane Alvarez');
    expect(mentionDisplayName({ fullName: null, loginName: null })).toBe('');
  });

  it('matches a prefix of the first name, last name, or full name', () => {
    expect(nameMatchesQuery('John Cyganiak', 'jo')).toBe(true);
    expect(nameMatchesQuery('John Cyganiak', 'cyg')).toBe(true);
    expect(nameMatchesQuery('John Cyganiak', 'john c')).toBe(true);
    expect(nameMatchesQuery('Elena Cruz', 'jo')).toBe(false);
    expect(filterMentionMembers([john, elena], 'jo').map((row) => row.userId)).toEqual([john.userId]);
    expect(filterMentionMembers([john, elena], 'cyg').map((row) => row.userId)).toEqual([john.userId]);
    expect(filterMentionMembers([john, elena, smith], 'john').map((row) => row.fullName)).toEqual([
      'John Cyganiak',
      'John Smith',
    ]);
    expect(filterMentionMembers([john, elena], 'john.c')).toEqual([]);
  });

  it('expands a unique typed name and leaves two Johns as text', () => {
    const compact = expandMentionTokens('@johncyganiak and @notaperson did the work?', [john, elena]);
    expect(compact).toContain('@[John Cyganiak](mention:11111111-1111-4111-8111-111111111111)');
    expect(compact).toContain('@notaperson');

    const spaced = expandMentionTokens('@John Cyganiak finished?', [john, elena]);
    expect(spaced).toContain('@[John Cyganiak](mention:11111111-1111-4111-8111-111111111111)');

    const ambiguous = expandMentionTokens('@John finished?', [john, smith]);
    expect(ambiguous).toBe('@John finished?');
  });

  it('splits a name token into a chip label', () => {
    const runs = splitMentionRuns(
      `@[John Cyganiak](mention:${john.userId}) and @[Elena Cruz](mention:${elena.userId})?`,
    );
    expect(runs.filter((run) => run.kind === 'mention').map((run) => run.kind === 'mention' && run.name)).toEqual([
      'John Cyganiak',
      'Elena Cruz',
    ]);
  });

  it('keeps the menu open while the name is incomplete and closes after the full name', () => {
    expect(mentionQueryAt('did @jo', 7)?.query).toBe('jo');
    expect(mentionQueryAt('@John C', 7, [john])?.query).toBe('John C');
    expect(mentionQueryAt('@John Cyganiak ', '@John Cyganiak '.length, [john])).toBeNull();
    expect(mentionQueryAt('@John ', 6, [john, smith])?.query).toBe('John');
  });
});
