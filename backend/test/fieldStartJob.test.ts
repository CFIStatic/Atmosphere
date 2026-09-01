import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldStartJobSchema } from '../src/lib/validation.js';
import {
  FIELD_DEFAULT_BRIEF,
  intakeFromFieldStart,
  scopeFromSituation,
  workTypeFromSituation,
} from '../src/field/startJob.js';

test('field start job: name is required; address is not collected', () => {
  const parsed = fieldStartJobSchema.parse({
    title: '  East Racine Avenue  ',
  });
  assert.equal(parsed.title, 'East Racine Avenue');
  assert.equal(parsed.situation, undefined);
  assert.equal('address' in parsed, false);
});

test('field start job: rejects a blank name', () => {
  assert.throws(() => fieldStartJobSchema.parse({ title: '  ' }));
});

test('field start job: optional situation is trimmed', () => {
  const parsed = fieldStartJobSchema.parse({
    title: 'East Racine',
    situation: '  Extract standing water.  ',
  });
  assert.equal(parsed.situation, 'Extract standing water.');
});

test('intakeFromFieldStart maps the phone form onto the office job file', () => {
  const withNote = intakeFromFieldStart({
    title: 'East Racine Avenue',
    situation: 'Extract standing water in the living room.',
  });
  assert.equal(withNote.title, 'East Racine Avenue');
  assert.equal(withNote.workType, 'mitigation');
  assert.equal(withNote.address, '');
  assert.equal(withNote.briefNote, 'Extract standing water in the living room.');
  assert.deepEqual(withNote.scope, [
    { title: 'Extract standing water in the living room.', state: 'included' },
  ]);
  assert.equal(withNote.facts.Source, 'Field Capture — name and work description');
  assert.equal(withNote.facts.Work, 'Extract standing water in the living room.');
  assert.equal(withNote.facts.Site, undefined);
  assert.deepEqual(withNote.invitees, []);

  const nameOnly = intakeFromFieldStart({
    title: 'Cedar Ridge',
  });
  assert.equal(nameOnly.workType, 'construction');
  assert.equal(nameOnly.briefNote, FIELD_DEFAULT_BRIEF);
  assert.deepEqual(nameOnly.scope, []);
  assert.equal(nameOnly.facts.Source, 'Field Capture — name only');
  assert.equal(nameOnly.address, '');
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
