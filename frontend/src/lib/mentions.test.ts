import { describe, expect, it } from 'vitest';
import {
  assignOrgHandles,
  expandMentionTokens,
  filterMentionMembers,
  mentionQueryAt,
  splitMentionRuns,
  type MentionMember,
} from './mentions';

const john: MentionMember = {
  userId: '11111111-1111-4111-8111-111111111111',
  handle: 'johncyganiak',
  fullName: 'John Cyganiak',
  email: 'john.cyganiak@ortizrestoration.com',
};
const elena: MentionMember = {
  userId: 'u-elena',
  handle: 'elenacruz',
  fullName: 'Elena Cruz',
  email: 'elena@ortizrestoration.com',
};

describe('mention parsing', () => {
  it('derives stable handles and suffixes collisions', () => {
    const assigned = assignOrgHandles([
      { userId: 'b', fullName: 'Sam Ruiz', email: 'sam@example.com', handle: null },
      { userId: 'a', fullName: 'Sam Ruiz', email: 'other@example.com', handle: null },
      { userId: 'c', fullName: null, email: 'john.cyganiak@ortizrestoration.com', handle: 'johncyganiak' },
    ]);
    const byId = Object.fromEntries(assigned.map((row) => [row.userId, row.handle]));
    expect(byId.c).toBe('johncyganiak');
    expect(byId.a).toBe('samruiz');
    expect(byId.b).toBe('samruiz2');
  });

  it('expands bare handles and keeps unknown ones as text', () => {
    const text = expandMentionTokens('@johncyganiak and @notaperson did the work?', [john, elena]);
    expect(text).toContain('@[johncyganiak](mention:11111111-1111-4111-8111-111111111111)');
    expect(text).toContain('@notaperson');
  });

  it('splits multiple mention tokens into chips', () => {
    const runs = splitMentionRuns(
      `@[johncyganiak](mention:${john.userId}) and @[elenacruz](mention:${elena.userId})?`,
    );
    expect(runs.filter((run) => run.kind === 'mention').map((run) => run.kind === 'mention' && run.handle)).toEqual([
      'johncyganiak',
      'elenacruz',
    ]);
  });

  it('filters the open @ query by handle, name, and email prefix', () => {
    expect(mentionQueryAt('did @jo', 7)?.query).toBe('jo');
    expect(filterMentionMembers([john, elena], 'john.c').map((row) => row.handle)).toEqual(['johncyganiak']);
    expect(filterMentionMembers([john, elena], 'elena').map((row) => row.handle)).toEqual(['elenacruz']);
    expect(filterMentionMembers([john, elena], 'cruz').map((row) => row.handle)).toEqual(['elenacruz']);
  });
});
