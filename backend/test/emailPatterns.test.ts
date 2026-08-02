import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPattern,
  candidateEmails,
  inferPattern,
  patternsMatching,
  splitName,
} from '../src/prospecting/patterns.js';
import { isFreeDomain, isRoleAddress, splitEmail } from '../src/prospecting/verification.js';

// Pattern inference is how the product finds people no vendor sells. These
// tests defend the two properties that make it safe: it only produces
// candidates it can justify, and it refuses when it cannot.

test('splitName handles ordinary names, honorifics, and suffixes', () => {
  assert.deepEqual(splitName('Marcia Delgado'), { first: 'marcia', last: 'delgado' });
  assert.deepEqual(splitName('Dr. Tomas Bergeron'), { first: 'tomas', last: 'bergeron' });
  assert.deepEqual(splitName('Grant Feasley Jr.'), { first: 'grant', last: 'feasley' });
  // Middle names are ignored: the convention is built from first and last.
  assert.deepEqual(splitName('Ray D Calloway'), { first: 'ray', last: 'calloway' });
});

test('splitName strips accents and punctuation, keeping hyphenated surnames whole', () => {
  assert.deepEqual(splitName('Lena Ortiz-Park'), { first: 'lena', last: 'ortizpark' });
  assert.deepEqual(splitName('José Núñez'), { first: 'jose', last: 'nunez' });
  assert.deepEqual(splitName("Sean O'Brien"), { first: 'sean', last: 'obrien' });
});

test('splitName refuses a name it cannot use rather than guessing', () => {
  assert.equal(splitName('Madonna'), null);
  assert.equal(splitName(''), null);
  assert.equal(splitName('   '), null);
  assert.equal(splitName('Dr.'), null);
});

test('applyPattern renders each convention', () => {
  const name = { first: 'marcia', last: 'delgado' };
  assert.equal(applyPattern('{first}.{last}', name, 'acme.com'), 'marcia.delgado@acme.com');
  assert.equal(applyPattern('{f}{last}', name, 'acme.com'), 'mdelgado@acme.com');
  assert.equal(applyPattern('{first}', name, 'acme.com'), 'marcia@acme.com');
  assert.equal(applyPattern('{last}{f}', name, 'acme.com'), 'delgadom@acme.com');
});

test('patternsMatching attributes an address to the conventions that produce it', () => {
  assert.ok(patternsMatching('marcia.delgado@acme.com', 'Marcia Delgado').includes('{first}.{last}'));
  assert.ok(patternsMatching('mdelgado@acme.com', 'Marcia Delgado').includes('{f}{last}'));
  // An address that belongs to nobody by any convention attributes to nothing.
  assert.deepEqual(patternsMatching('sales@acme.com', 'Marcia Delgado'), []);
});

test('inferPattern learns a company convention from its known addresses', () => {
  const known = [
    { email: 'marcia.delgado@acme.com', fullName: 'Marcia Delgado' },
    { email: 'ray.calloway@acme.com', fullName: 'Ray Calloway' },
    { email: 'tomas.bergeron@acme.com', fullName: 'Tomas Bergeron' },
  ];
  const inferred = inferPattern(known, 'acme.com');
  assert.ok(inferred);
  assert.equal(inferred.pattern, '{first}.{last}');
  assert.equal(inferred.support, 3);
  assert.equal(inferred.confidence, 1);
});

test('inference is per domain and never bleeds across companies', () => {
  const known = [
    { email: 'marcia.delgado@acme.com', fullName: 'Marcia Delgado' },
    { email: 'rcalloway@other.com', fullName: 'Ray Calloway' },
  ];
  assert.equal(inferPattern(known, 'acme.com')?.pattern, '{first}.{last}');
  assert.equal(inferPattern(known, 'other.com')?.pattern, '{f}{last}');
  // A domain we know nothing about yields nothing, rather than borrowing.
  assert.equal(inferPattern(known, 'unseen.com'), null);
});

test('inference reports lower confidence when a company is inconsistent', () => {
  const known = [
    { email: 'marcia.delgado@acme.com', fullName: 'Marcia Delgado' },
    { email: 'rcalloway@acme.com', fullName: 'Ray Calloway' },
  ];
  const inferred = inferPattern(known, 'acme.com');
  assert.ok(inferred);
  assert.ok(inferred.confidence < 1, 'a split convention must not claim certainty');
});

test('candidateEmails leads with the learned convention, then falls back', () => {
  const known = [
    { email: 'ray.calloway@acme.com', fullName: 'Ray Calloway' },
    { email: 'tomas.bergeron@acme.com', fullName: 'Tomas Bergeron' },
  ];
  const candidates = candidateEmails('Marcia Delgado', 'acme.com', known, 4);
  assert.equal(candidates[0], 'marcia.delgado@acme.com');
  assert.equal(candidates.length, 4);
  assert.equal(new Set(candidates).size, 4, 'candidates must not repeat');
  assert.ok(candidates.every((c) => c.endsWith('@acme.com')));
});

test('candidateEmails still works with no evidence, in prevalence order', () => {
  const candidates = candidateEmails('Marcia Delgado', 'acme.com', [], 3);
  assert.deepEqual(candidates, [
    'marcia.delgado@acme.com',
    'mdelgado@acme.com',
    'marcia@acme.com',
  ]);
});

test('candidateEmails produces nothing it could not justify', () => {
  assert.deepEqual(candidateEmails('Madonna', 'acme.com'), []);
  assert.deepEqual(candidateEmails('Marcia Delgado', ''), []);
});

test('role and free-mail addresses are recognised so they are never sold as contacts', () => {
  assert.equal(isRoleAddress('info@acme.com'), true);
  assert.equal(isRoleAddress('sales@acme.com'), true);
  assert.equal(isRoleAddress('marcia.delgado@acme.com'), false);

  assert.equal(isFreeDomain('someone@gmail.com'), true);
  assert.equal(isFreeDomain('marcia@acme.com'), false);
});

test('splitEmail lowercases and splits on the final @', () => {
  assert.deepEqual(splitEmail('Marcia.Delgado@Acme.com'), {
    local: 'marcia.delgado',
    domain: 'acme.com',
  });
  assert.equal(splitEmail('not-an-email'), null);
});
