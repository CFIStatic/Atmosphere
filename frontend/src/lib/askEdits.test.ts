import { describe, expect, it } from 'vitest';
import { visibleAfterEdits } from './askEdits';
import { turnsFromQuestions } from './jobFileAsk';
import type { ProofQuestion } from './api';

const q = (id: string, minute: string, supersedes_id: string | null = null): ProofQuestion => ({
  id,
  question: `Question ${id}?`,
  answer: `Answer ${id}.`,
  grounded_on: [],
  created_at: `2026-10-09T10:${minute}:00Z`,
  supersedes_id,
});

describe('edited questions', () => {
  it('an edit replaces the question it points at and everything after it', () => {
    expect(visibleAfterEdits([q('a', '01'), q('b', '02'), q('c', '03'), q('b2', '04', 'b')]).map((r) => r.id)).toEqual(['a', 'b2']);
  });

  it('a reloaded chat shows the edit in place of the original', () => {
    const turns = turnsFromQuestions([q('a', '01'), q('b', '02'), q('c', '03'), q('b2', '04', 'b'), q('d', '05')]);
    expect(turns.filter((t) => t.role === 'user').map((t) => t.content)).toEqual(['Question a?', 'Question b2?', 'Question d?']);
  });
});
