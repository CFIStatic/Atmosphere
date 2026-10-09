import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleAfterEdits } from './askEdits.js';

const row = (id: string, at: string, supersedes_id: string | null = null) => ({ id, created_at: `2026-10-09T10:${at}:00Z`, supersedes_id });

test('an edit replaces the question it points at and everything asked after it', () => {
  const rows = [row('q1', '01'), row('q2', '02'), row('q3', '03'), row('q2b', '04', 'q2'), row('q4', '05')];
  assert.deepEqual(visibleAfterEdits(rows).map((r) => r.id), ['q1', 'q2b', 'q4']);
});

test('editing the edit replaces it again', () => {
  const rows = [row('q1', '01'), row('q1b', '02', 'q1'), row('q1c', '03', 'q1b')];
  assert.deepEqual(visibleAfterEdits(rows).map((r) => r.id), ['q1c']);
});

test('an edit of a question older than the window hides what came before it in the window', () => {
  const rows = [row('q5', '05'), row('q6', '06'), row('q3b', '07', 'q3-not-loaded'), row('q8', '08')];
  assert.deepEqual(visibleAfterEdits(rows).map((r) => r.id), ['q3b', 'q8']);
});

test('an edit being asked now drops the replaced question and what followed from the model context', () => {
  const rows = [row('q1', '01'), row('q2', '02'), row('q3', '03')];
  assert.deepEqual(visibleAfterEdits(rows, { supersedesId: 'q2', supersededAt: null }).map((r) => r.id), ['q1']);
  assert.deepEqual(visibleAfterEdits(rows, { supersedesId: 'gone', supersededAt: '2026-10-09T10:03:00Z' }).map((r) => r.id), ['q1', 'q2']);
});

test('no edits: everything stays, in time order', () => {
  assert.deepEqual(visibleAfterEdits([row('b', '02'), row('a', '01')]).map((r) => r.id), ['a', 'b']);
});
