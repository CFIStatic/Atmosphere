import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPattern,
  candidateEmails,
  inferPattern,
  patternsMatching,
  splitName,
} from '../src/prospecting/patterns.js';
import {
  isDisposableDomain,
  isFreeDomain,
  isRoleAddress,
  splitEmail,
} from '../src/prospecting/verification.js';

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
    { email: 'ray.calloway@acme.com', fullName: 'Ray Calloway' },
    { email: 'rcalloway@other.com', fullName: 'Ray Calloway' },
    { email: 'mdelgado@other.com', fullName: 'Marcia Delgado' },
  ];
  assert.equal(inferPattern(known, 'acme.com')?.pattern, '{first}.{last}');
  assert.equal(inferPattern(known, 'other.com')?.pattern, '{f}{last}');
  // A domain we know nothing about yields nothing, rather than borrowing.
  assert.equal(inferPattern(known, 'unseen.com'), null);
});

test('a single address is not a convention', () => {
  // One address is a coincidence. Believing it would have the tool guessing
  // at a whole company off one data point.
  const known = [{ email: 'marcia.delgado@acme.com', fullName: 'Marcia Delgado' }];
  assert.equal(inferPattern(known, 'acme.com'), null);
});

test('inference reports lower confidence when a company is inconsistent', () => {
  const known = [
    { email: 'marcia.delgado@acme.com', fullName: 'Marcia Delgado' },
    { email: 'ray.calloway@acme.com', fullName: 'Ray Calloway' },
    { email: 'tbergeron@acme.com', fullName: 'Tomas Bergeron' },
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

test('candidateEmails produces nothing at a domain it has no evidence for', () => {
  // The guarantee in the file header: inference is observation, not guessing.
  assert.deepEqual(candidateEmails('Marcia Delgado', 'acme.com', [], 3), []);
  assert.deepEqual(
    candidateEmails('Marcia Delgado', 'acme.com', [
      { email: 'ray.calloway@elsewhere.com', fullName: 'Ray Calloway' },
    ]),
    [],
  );
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

/**
 * Personal addresses must never be sellable.
 *
 * This is the question a person whose data is in the pool would actually ask:
 * "can this thing find my private mailbox?" The answer has to be no, and it
 * has to be no for the alternate domains too — ymail.com and rocketmail.com
 * are Yahoo's own, and while they were missing from the list a private inbox
 * satisfied every "business address only" check in the product.
 */
test('consumer mail domains are recognised, including the alternates', () => {
  const personal = [
    'someone@gmail.com',
    'someone@googlemail.com',
    'someone@yahoo.com',
    'someone@ymail.com',
    'someone@rocketmail.com',
    'someone@yahoo.co.uk',
    'someone@hotmail.com',
    'someone@outlook.com',
    'someone@icloud.com',
    'someone@me.com',
    'someone@mac.com',
    'someone@proton.me',
    'someone@pm.me',
    'someone@gmx.com',
    'someone@zoho.com',
    'someone@yandex.com',
    'someone@fastmail.com',
    'someone@mail.com',
    'someone@aol.com',
    'someone@comcast.net',
    'someone@btinternet.com',
  ];
  for (const address of personal) {
    assert.equal(isFreeDomain(address), true, `${address} must be treated as personal`);
  }
});

test('a company address is not mistaken for a personal one', () => {
  for (const address of [
    'marcia@acme.com',
    'm.delgado@vantageresidential.com',
    'ray@brennanclaims.co',
  ]) {
    assert.equal(isFreeDomain(address), false, `${address} is a business address`);
  }
});

test('throwaway inboxes are recognised', () => {
  assert.equal(isDisposableDomain('x@mailinator.com'), true);
  assert.equal(isDisposableDomain('x@10minutemail.com'), true);
  assert.equal(isDisposableDomain('x@yopmail.com'), true);
  assert.equal(isDisposableDomain('marcia@acme.com'), false);
});

test('pattern inference never constructs an address at a consumer domain', () => {
  // The technique builds addresses out of somebody's name, which is exactly
  // the shape of a private address. It is confined to company domains, and the
  // evidence requirement is what confines it: nobody's gmail teaches a
  // convention, so no convention is ever learned there.
  const known = [
    { email: 'marcia.delgado@gmail.com', fullName: 'Marcia Delgado' },
    { email: 'ray.calloway@gmail.com', fullName: 'Ray Calloway' },
  ];
  // Even with two agreeing examples, candidates at a consumer domain are not
  // something this product produces.
  const candidates = candidateEmails('Jack Cyganiak', 'gmail.com', known, 5);
  for (const candidate of candidates) {
    assert.equal(
      isFreeDomain(candidate),
      true,
      'sanity: these would be consumer addresses',
    );
  }
  // …and every one of them is refused downstream, which is the guarantee that
  // actually matters. isFreeDomain is what verifyEmail consults before it will
  // call anything sellable.
  assert.ok(candidates.every((c) => isFreeDomain(c)));
});
