import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysis } from '../src/shared/proofAnalyst.js';

/**
 * Reading the model's reply.
 *
 * The failure that matters is not a crash. It is a malformed reply half-parsed
 * into a summary that reads authoritative and says nothing true — attached to a
 * day somebody is about to pay for. So anything not exactly the shape asked for
 * comes back null, and null means "not analysed", which is honest.
 */

test('a well-formed reply parses', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Drywall hung across the north wall of the master bedroom.',
      changes: ['Bare studs in the before, hung and taped board in the after'],
      cannotTell: ['The ceiling is out of frame in both'],
      scopeTouched: ['Hang and finish drywall, level 2'],
      concerns: [],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.changes.length, 1);
  assert.equal(parsed.cannotTell.length, 1);
  assert.equal(parsed.concerns.length, 0);
});

test('a fenced code block is accepted rather than thrown away', () => {
  // The model is told JSON only; a fence is the common near-miss and discarding
  // a good answer over punctuation would be worse than accepting it.
  const parsed = parseAnalysis('```json\n{"summary":"No visible change between the two."}\n```');
  assert.ok(parsed);
  assert.equal(parsed.summary, 'No visible change between the two.');
  assert.deepEqual(parsed.changes, []);
});

test('prose instead of JSON comes back null', () => {
  assert.equal(parseAnalysis('It looks like they hung some drywall today.'), null);
  assert.equal(parseAnalysis(''), null);
  assert.equal(parseAnalysis('{'), null);
});

test('JSON without a summary is not an analysis', () => {
  // A day with changes and no summary would render as a confident finding with
  // nothing standing behind it.
  assert.equal(parseAnalysis(JSON.stringify({ changes: ['something'] })), null);
  assert.equal(parseAnalysis(JSON.stringify({ summary: '   ' })), null);
  assert.equal(parseAnalysis(JSON.stringify({ summary: 42 })), null);
});

test('non-string list entries are dropped, not coerced', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Something happened.',
      changes: ['real', 42, null, { a: 1 }, '', '  ', 'also real'],
      concerns: 'not a list',
    }),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.changes, ['real', 'also real']);
  assert.deepEqual(parsed.concerns, []);
});

test('a runaway list is capped', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Something happened.',
      changes: Array.from({ length: 50 }, (_, i) => `change ${i}`),
    }),
  );
  assert.equal(parsed?.changes.length, 12);
});

test('"no visible change" survives intact', () => {
  // The most important answer this thing can give, and the easiest to lose to
  // over-eager normalising.
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'The before and after frames look substantially the same.',
      changes: [],
      cannotTell: ['Lighting differs, but no work is visible in either'],
    }),
  );
  assert.ok(parsed);
  assert.match(parsed.summary, /substantially the same/);
  assert.deepEqual(parsed.changes, []);
});
