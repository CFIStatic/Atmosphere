import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitiveCategory, EXCLUDED_CATEGORIES } from '../src/prospecting/profiler/index.js';

/**
 * The Profiler's boundary is the feature, not a caveat attached to it.
 *
 * Professional context — a role, an employer, a company announcement — is what
 * makes a sales call informed. Assembling scattered public facts about
 * somebody's private life into one screen is a different product entirely, and
 * these tests are what keep the code on the correct side of that line when
 * somebody later widens a regex.
 *
 * The failure being guarded is specific: a bio sentence that happens to
 * mention a spouse or a church would otherwise land on a sales screen, where a
 * salesperson would read it and use it.
 */

test('family details are refused', () => {
  assert.equal(sensitiveCategory('He lives with his wife and three children.'), 'family');
  assert.equal(sensitiveCategory('Married for twenty years.'), 'family');
  assert.equal(sensitiveCategory('Her daughter attends the local school.'), 'family');
});

test('religion and politics are refused', () => {
  assert.equal(sensitiveCategory('An active member of his church.'), 'religion');
  assert.equal(sensitiveCategory('She ran for office in 2019.'), 'politics');
  assert.equal(sensitiveCategory('A lifelong Republican.'), 'politics');
});

test('health is refused', () => {
  assert.equal(sensitiveCategory('A cancer survivor who speaks about recovery.'), 'health');
  assert.equal(sensitiveCategory('Following his diagnosis, he stepped back.'), 'health');
});

test('home address and age are refused', () => {
  assert.equal(sensitiveCategory('He lives in Round Rock with his family.'), 'home address');
  assert.equal(sensitiveCategory('Marcia, age 47, joined in 2019.'), 'age');
  assert.equal(sensitiveCategory('Born in 1974, he began his career in roofing.'), 'age');
});

test('ordinary professional biography passes untouched', () => {
  // The other half of the guarantee. A filter that refuses everything is
  // useless — this is exactly the material the product exists to surface.
  for (const sentence of [
    'Marcia Delgado has managed the North Austin portfolio since 2021.',
    'Tomas Bergeron is Facilities Director at Northgate Medical Group.',
    'She oversees maintenance across eleven commercial properties.',
    'Northgate announced the opening of its third clinic in March.',
    'Ray joined the claims team after eight years as an independent adjuster.',
  ]) {
    assert.equal(sensitiveCategory(sentence), null, `should pass: ${sentence}`);
  }
});

test('the excluded categories are declared for the UI to show', () => {
  // The boundary is stated on the screen, not only in the code — somebody
  // reading a profile should be able to see what was never looked for.
  assert.ok(EXCLUDED_CATEGORIES.includes('Home address'));
  assert.ok(EXCLUDED_CATEGORIES.includes('Family and relationships'));
  assert.ok(EXCLUDED_CATEGORIES.includes('Health'));
  assert.ok(EXCLUDED_CATEGORIES.includes('Religion'));
  assert.ok(EXCLUDED_CATEGORIES.includes('Politics'));
  assert.ok(EXCLUDED_CATEGORIES.length >= 6);
});
