import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayJobFileName,
  jobFileDeleteNameMatches,
  normalizeJobFileTitle,
  scopeLinesForDuplicate,
  suggestedDuplicateTitle,
} from '../src/shared/jobFileCopy.js';

test('normalizeJobFileTitle trims and collapses spaces', () => {
  assert.equal(normalizeJobFileTitle('  Cedar   Ridge  '), 'Cedar Ridge');
});

test('normalizeJobFileTitle rejects an empty name', () => {
  assert.throws(() => normalizeJobFileTitle('  '), /too short/i);
  assert.throws(() => normalizeJobFileTitle('A'), /too short/i);
});

test('displayJobFileName keeps a stored title, even if it looks like scope', () => {
  assert.equal(
    displayJobFileName('Remove wet drywall to 24"', '1842 Meridian Ave'),
    'Remove wet drywall to 24"',
  );
  assert.equal(displayJobFileName('  Kitchen rebuild  ', ''), 'Kitchen rebuild');
});

test('displayJobFileName falls back to the street when the title is blank', () => {
  assert.equal(displayJobFileName('', '1842 Meridian Ave, Austin, TX'), '1842 Meridian Ave');
  assert.equal(displayJobFileName(null, ''), 'New job');
});

test('jobFileDeleteNameMatches requires the exact dashboard name', () => {
  assert.equal(jobFileDeleteNameMatches('Cedar Ridge — storm damage', 'Cedar Ridge — storm damage'), true);
  assert.equal(jobFileDeleteNameMatches('  Cedar Ridge  ', 'Cedar Ridge'), true);
  assert.equal(jobFileDeleteNameMatches('Cedar Ridge', 'cedar ridge'), false);
  assert.equal(jobFileDeleteNameMatches('Cedar Ridge', 'Cedar'), false);
  assert.equal(jobFileDeleteNameMatches('Cedar Ridge', ''), false);
  assert.equal(jobFileDeleteNameMatches('', 'Job'), false);
});

test('suggestedDuplicateTitle prefixes once and stays within length', () => {
  assert.equal(suggestedDuplicateTitle('Cedar Ridge rebuild'), 'Copy of Cedar Ridge rebuild');
  assert.equal(suggestedDuplicateTitle('Copy of Cedar Ridge rebuild'), 'Copy of Cedar Ridge rebuild');
  assert.equal(suggestedDuplicateTitle('  '), 'Copy of Job');
  const long = 'X'.repeat(250);
  assert.equal(suggestedDuplicateTitle(long).length, 200);
});

test('scopeLinesForDuplicate keeps the current revision and resets decisions', () => {
  const copied = scopeLinesForDuplicate(
    [
      { title: 'Tear off roof', state: 'included', revision: 4, amount: 0 },
      { title: 'Old line', state: 'included', revision: 1 },
      { title: 'Do not touch solar', state: 'excluded', reason: 'Warranty', revision: 4 },
      { title: 'Ridge vent', state: 'approved', amount: 400, revision: 4 },
      { title: 'A', state: 'included', revision: 4 },
    ],
    4,
  );
  assert.deepEqual(
    copied.map((l) => l.title),
    ['Tear off roof', 'Do not touch solar', 'Ridge vent'],
  );
  assert.equal(copied[1]?.state, 'excluded');
  assert.equal(copied[1]?.reason, 'Warranty');
  assert.equal(copied[2]?.state, 'included');
});
