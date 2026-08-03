import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorsOf,
  subtreeOf,
  reparentProblem,
  mergeProblem,
  suggestWinner,
  nameSimilarity,
  findDuplicates,
  describeLink,
  type AccountNode,
} from '../src/crm/accounts.js';

/**
 * Account structure.
 *
 * The two operations here ruin data rather than inconvenience it: a cycle hangs
 * every rollup on the page, and a merge repoints hundreds of records with no
 * one-click way back. So the tests are mostly about what gets refused.
 */

const node = (id: string, name: string, parent: string | null = null, over: Partial<AccountNode> = {}): AccountNode => ({
  id,
  name,
  parentAccountId: parent,
  ...over,
});

// A property management company over two HOAs, one with a sub-association.
const TREE: AccountNode[] = [
  node('pm', 'Vantage Property Management'),
  node('cedar', 'Cedar Ridge HOA', 'pm'),
  node('cedar-north', 'Cedar Ridge North Section', 'cedar'),
  node('harbor', 'Harbor Point Condos', 'pm'),
  node('lone', 'Lakeview Dental'),
];

test('ancestors run from the account up to the root', () => {
  assert.deepEqual(
    ancestorsOf('cedar-north', TREE).map((a) => a.id),
    ['cedar', 'pm'],
  );
  assert.deepEqual(ancestorsOf('pm', TREE), []);
  assert.deepEqual(ancestorsOf('lone', TREE), []);
});

test('a cycle in existing data stops the walk rather than hanging it', () => {
  // Data can predate the guard. A short breadcrumb beats a page that never
  // finishes rendering.
  const looped = [node('a', 'A', 'b'), node('b', 'B', 'a')];
  const walked = ancestorsOf('a', looped);
  assert.ok(walked.length <= 2);
});

test('a subtree includes the account itself and everything under it', () => {
  assert.deepEqual(
    subtreeOf('pm', TREE).map((a) => a.id).sort(),
    ['cedar', 'cedar-north', 'harbor', 'pm'],
  );
  assert.deepEqual(subtreeOf('cedar', TREE).map((a) => a.id).sort(), ['cedar', 'cedar-north']);
  assert.deepEqual(subtreeOf('lone', TREE).map((a) => a.id), ['lone']);
});

test('reparenting under a descendant is refused, in words', () => {
  // The one that matters: a loop hangs every rollup and breadcrumb.
  const problem = reparentProblem('pm', 'cedar-north', TREE);
  assert.ok(problem);
  assert.match(problem, /already sits under/);
  assert.match(problem, /loop/);
});

test('an account cannot be its own parent', () => {
  assert.match(reparentProblem('cedar', 'cedar', TREE)!, /its own parent/);
});

test('clearing the parent is always allowed', () => {
  assert.equal(reparentProblem('cedar', null, TREE), null);
});

test('a legitimate reparent passes', () => {
  assert.equal(reparentProblem('lone', 'pm', TREE), null);
  assert.equal(reparentProblem('harbor', 'cedar', TREE), null);
});

test('a merged account cannot be a parent', () => {
  const withTombstone = [...TREE, node('old', 'Old Cedar Ridge', null, { mergedIntoId: 'cedar' })];
  const problem = reparentProblem('lone', 'old', withTombstone);
  assert.ok(problem);
  assert.match(problem, /merged into another account/);
});

test('merging a parent away from under itself is refused as probably a misclick', () => {
  // Two rows in a duplicate list look identical; inverting a hierarchy
  // somebody built on purpose is almost never what they meant.
  const problem = mergeProblem('cedar-north', 'pm', TREE);
  assert.ok(problem);
  assert.match(problem, /above/);
  assert.match(problem, /which one you meant to keep/);
});

test('merging a child up into its parent is fine', () => {
  assert.equal(mergeProblem('pm', 'cedar-north', TREE), null);
});

test('an already-merged account cannot be merged again, either way round', () => {
  const withTombstone = [...TREE, node('old', 'Old Cedar', null, { mergedIntoId: 'cedar' })];
  assert.match(mergeProblem('cedar', 'old', withTombstone)!, /already been merged/);
  // And merging into a tombstone would daisy-chain redirects to nowhere.
  assert.match(mergeProblem('old', 'lone', withTombstone)!, /Merge into that one instead/);
});

test('the same account twice is not a merge', () => {
  assert.match(mergeProblem('cedar', 'cedar', TREE)!, /same account twice/);
});

test('punctuation and company suffixes do not make two records different', () => {
  assert.equal(nameSimilarity('Cedar Ridge HOA', 'Cedar Ridge H.O.A.'), 1);
  assert.equal(nameSimilarity('Vantage Property Management, Inc.', 'Vantage Property Management LLC'), 1);
  assert.equal(nameSimilarity('The Harbor Point Condos', 'Harbor Point Condos'), 1);
});

test('two streets apart is two customers', () => {
  // The false positive that matters. These are different HOAs and merging them
  // would fuse two customers' histories with no way back.
  assert.ok(nameSimilarity('Cedar Ridge HOA', 'Cedar Grove HOA') < 0.6, 'Ridge vs Grove');
  assert.ok(nameSimilarity('Lakeview Dental', 'Lakeview Medical') < 0.6, 'Dental vs Medical');
});

test('a single shared word is not a match', () => {
  assert.ok(nameSimilarity('Austin Roofing', 'Austin Plumbing and Heating Supply') < 0.6);
});

test('duplicates come back ordered, and never include a tombstone', () => {
  const accounts = [
    { ...node('a', 'Cedar Ridge HOA'), createdAt: '2026-01-01T00:00:00Z', attached: 14 },
    { ...node('b', 'Cedar Ridge H.O.A.'), createdAt: '2026-05-01T00:00:00Z', attached: 2 },
    { ...node('c', 'Cedar Grove HOA'), createdAt: '2026-02-01T00:00:00Z', attached: 5 },
    {
      ...node('d', 'Cedar Ridge HOA', null, { mergedIntoId: 'a' }),
      createdAt: '2026-03-01T00:00:00Z',
      attached: 0,
    },
  ];

  const pairs = findDuplicates(accounts);
  assert.ok(pairs.length >= 1);
  assert.equal(pairs[0].score, 1);
  assert.deepEqual([pairs[0].a.id, pairs[0].b.id].sort(), ['a', 'b']);
  // The record people have actually been using wins.
  assert.equal(pairs[0].suggestedWinner, 'a');
  assert.ok(!pairs.some((p) => p.a.id === 'd' || p.b.id === 'd'), 'tombstone offered as a duplicate');
});

test('the record with more attached to it is the one to keep', () => {
  assert.equal(
    suggestWinner(
      { id: 'busy', createdAt: '2026-05-01T00:00:00Z', attached: 40 },
      { id: 'old', createdAt: '2026-01-01T00:00:00Z', attached: 1 },
    ),
    'busy',
  );
  // A tie goes to the older record — its id is in everybody's exports.
  assert.equal(
    suggestWinner(
      { id: 'newer', createdAt: '2026-05-01T00:00:00Z', attached: 3 },
      { id: 'older', createdAt: '2026-01-01T00:00:00Z', attached: 3 },
    ),
    'older',
  );
});

test('a link reads correctly from either end', () => {
  assert.equal(describeLink('insures', 'from', 'Cedar Ridge HOA'), 'insures Cedar Ridge HOA');
  assert.equal(describeLink('insures', 'to', 'Meridian Mutual'), 'is insured by Meridian Mutual');
  assert.equal(describeLink('manages', 'to', 'Vantage'), 'is managed by Vantage');
  // An unknown kind still reads as a sentence rather than a raw enum.
  assert.equal(describeLink('nonsense', 'from', 'Acme'), 'is connected to Acme');
});
