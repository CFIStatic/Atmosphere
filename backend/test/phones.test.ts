import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, formatPhone, samePhone, toE164 } from '../src/prospecting/phone/index.js';

/**
 * Phones had no verification at all before this: whatever a vendor said was
 * what a customer dialled. Two properties matter now, and both are the kind
 * that fail silently.
 *
 *   Normalisation must refuse rather than guess. A string mangled into a
 *   plausible wrong number is worse than one left alone, because nobody can
 *   tell by looking that it was invented.
 *
 *   Labelling must err toward 'personal'. Calling a work cell "personal"
 *   costs a salesperson a moment's hesitation; calling a private cell "work"
 *   is how somebody gets cold-called on the number they give their family.
 */

test('NANP numbers normalise to E.164 however they were written', () => {
  for (const written of [
    '(512) 555-0110',
    '512-555-0110',
    '512.555.0110',
    '5125550110',
    '1-512-555-0110',
    '+1 (512) 555-0110',
    '  512 555 0110  ',
  ]) {
    assert.equal(toE164(written), '+15125550110', `${written} should normalise`);
  }
});

test('extensions are stripped — they break every lookup API', () => {
  assert.equal(toE164('(512) 555-0110 x14'), '+15125550110');
  assert.equal(toE164('512-555-0110 ext. 202'), '+15125550110');
  assert.equal(toE164('512-555-0110 #7'), '+15125550110');
});

test('normalisation refuses what it cannot parse rather than guessing', () => {
  // Each of these could be coerced into something that looks like a phone
  // number. Doing so would produce a number nobody wrote down, which somebody
  // would then dial.
  assert.equal(toE164('12345'), null);
  assert.equal(toE164('not a phone'), null);
  assert.equal(toE164(''), null);
  assert.equal(toE164(null), null);
  // Area codes and exchanges never begin with 0 or 1.
  assert.equal(toE164('012-555-0110'), null);
  assert.equal(toE164('112-555-0110'), null);
  assert.equal(toE164('512-055-0110'), null);
});

test('an already-international number is preserved, not re-guessed as NANP', () => {
  assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(toE164('+61 2 5550 1234'), '+61255501234');
});

test('two writings of one number compare equal', () => {
  // This is what suppression depends on. When it was comparing whole digit
  // strings, a number stored as +1512… failed to block the same number stored
  // as (512)…, and the do-not-contact list silently let calls through.
  assert.equal(samePhone('(512) 555-0110', '+15125550110'), true);
  assert.equal(samePhone('512-555-0110', '1-512-555-0110'), true);
  assert.equal(samePhone('512-555-0110', '512-555-0111'), false);
  assert.equal(samePhone('512-555-0110', null), false);
});

test('formatting is for humans and leaves non-NANP alone', () => {
  assert.equal(formatPhone('+15125550110'), '(512) 555-0110');
  assert.equal(formatPhone('+442079460958'), '+442079460958');
  assert.equal(formatPhone(null), '');
});

test('a number the company published is a work number, whatever line it rings', () => {
  // Plenty of small contractors publish a cell as their business number, and
  // it is one — they printed it to be called.
  assert.equal(classify('published', 'mobile'), 'work');
  assert.equal(classify('published', 'landline'), 'work');
  assert.equal(classify('published', null), 'work');
});

test('desk lines are work numbers regardless of where they came from', () => {
  assert.equal(classify('vendor_work', 'landline'), 'work');
  assert.equal(classify('vendor_mobile', 'landline'), 'work');
  assert.equal(classify('unknown', 'voip'), 'work');
  assert.equal(classify('unknown', 'tollfree'), 'work');
});

test('an unattributed mobile is labelled personal, not work', () => {
  // The asymmetry that decides this rule: mislabelling a work cell costs a
  // moment of hesitation, mislabelling a private cell costs somebody their
  // privacy. So an unexplained mobile is treated as private.
  assert.equal(classify('unknown', 'mobile'), 'personal');
  assert.equal(classify('vendor_personal', 'mobile'), 'personal');
  assert.equal(classify('vendor_personal', 'landline'), 'personal');
});

test('a mobile from a business record is a work mobile', () => {
  assert.equal(classify('vendor_mobile', 'mobile'), 'mobile');
  assert.equal(classify('vendor_work', 'mobile'), 'mobile');
  assert.equal(classify('network', 'mobile'), 'mobile');
});

test('with no line type, provenance alone decides and stays vague', () => {
  // No lookup configured. Claiming to know the line type here would be
  // inventing a fact, so unknown provenance yields an unknown label.
  assert.equal(classify('vendor_work', null), 'work');
  assert.equal(classify('vendor_mobile', null), 'mobile');
  assert.equal(classify('unknown', null), 'unknown');
});
