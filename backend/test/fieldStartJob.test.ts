import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldStartJobSchema } from '../src/lib/validation.js';
import {
  FIELD_DEFAULT_BRIEF,
  cityPostalFromAddress,
  intakeFromFieldStart,
  scopeFromSituation,
  workTypeFromSituation,
} from '../src/field/startJob.js';

test('field start job: name and address are required', () => {
  const parsed = fieldStartJobSchema.parse({
    title: '  East Racine Avenue  ',
    address: '  1842 Meridian Ave, Austin, TX 78702  ',
  });
  assert.equal(parsed.title, 'East Racine Avenue');
  assert.equal(parsed.address, '1842 Meridian Ave, Austin, TX 78702');
  assert.equal(parsed.situation, undefined);
});

test('field start job: rejects a blank name or a placeholder address', () => {
  assert.throws(() => fieldStartJobSchema.parse({ title: '  ', address: '1842 Meridian Ave' }));
  assert.throws(() =>
    fieldStartJobSchema.parse({ title: 'East Racine', address: 'Address to confirm' }),
  );
});

test('field start job: optional situation is trimmed', () => {
  const parsed = fieldStartJobSchema.parse({
    title: 'East Racine',
    address: '1842 Meridian Ave, Austin, TX 78702',
    situation: '  Extract standing water.  ',
  });
  assert.equal(parsed.situation, 'Extract standing water.');
});

test('cityPostalFromAddress reads city and ZIP from a Places-formatted line', () => {
  assert.deepEqual(cityPostalFromAddress('East Racine Avenue, Waukesha, Wisconsin, 53186, US'), {
    city: 'Waukesha',
    postalCode: '53186',
  });
});

test('cityPostalFromAddress reads a UK postcode', () => {
  assert.deepEqual(cityPostalFromAddress('School Street, Llanbradach, Wales, CF83 3NB, GB'), {
    city: 'Llanbradach',
    postalCode: 'CF83 3NB',
  });
});

test('intakeFromFieldStart maps the phone form onto the office job file', () => {
  const withNote = intakeFromFieldStart({
    title: 'East Racine Avenue',
    address: '1842 Meridian Ave, Austin, TX 78702',
    situation: 'Extract standing water in the living room.',
  });
  assert.equal(withNote.title, 'East Racine Avenue');
  assert.equal(withNote.workType, 'mitigation');
  assert.equal(withNote.city, 'Austin');
  assert.equal(withNote.postalCode, '78702');
  assert.equal(withNote.briefNote, 'Extract standing water in the living room.');
  assert.deepEqual(withNote.scope, [
    { title: 'Extract standing water in the living room.', state: 'included' },
  ]);
  assert.equal(withNote.facts.Source, 'Field Capture — address and work description');
  assert.deepEqual(withNote.invitees, []);

  const addressOnly = intakeFromFieldStart({
    title: 'Cedar Ridge',
    address: '902 Cedar Ridge Dr, Austin, TX',
  });
  assert.equal(addressOnly.workType, 'construction');
  assert.equal(addressOnly.briefNote, FIELD_DEFAULT_BRIEF);
  assert.deepEqual(addressOnly.scope, []);
  assert.equal(addressOnly.facts.Source, 'Field Capture — address only');
});

test('intake RPC writes resolved country and coordinates', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/routes/jobIntake.ts', import.meta.url), 'utf8');
  assert.match(src, /p_region:/);
  assert.match(src, /p_country:/);
  assert.match(src, /p_latitude:/);
  assert.match(src, /p_longitude:/);
});

test('situation helpers match office intake', () => {
  assert.deepEqual(scopeFromSituation('  Extract standing water.  '), [
    { title: 'Extract standing water.', state: 'included' },
  ]);
  assert.deepEqual(scopeFromSituation(' '), []);
  assert.equal(workTypeFromSituation('Extract standing water'), 'mitigation');
  assert.equal(workTypeFromSituation('Replace the roof'), 'construction');
});
