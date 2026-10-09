import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlacement } from '../src/computer/fieldPlacement.js';
import type { ProjectedJobField } from '../src/computer/types.js';

const projection: ProjectedJobField[] = [
  { key: 'job.claimNumber', label: 'Claim number', value: 'CLM-0042', source: 'Job: Claim number' },
  { key: 'job.policyNumber', label: 'Policy number', value: 'HO-77812', source: 'Job: Policy number' },
  { key: 'job.address', label: 'Property address', value: '412 Elm St, Plano, TX 75023', source: 'Job: Property address' },
  { key: 'fact.insured_name', label: 'Insured name', value: 'Jane Testcase', source: 'Job brief: Insured name' },
  { key: 'fact.insured_phone', label: 'Insured phone', value: '972-555-0142', source: 'Job brief: Insured phone' },
  { key: 'fact.date_of_loss', label: 'Date of loss', value: '10/03/2026', source: 'Job brief: Date of loss' },
];
const instructions = 'File the claim on the carrier portal. Contact email is jane.t@example.test. Use roof type architectural shingle.';
const check = (label: string, value: string) => checkPlacement({ label, value, projection, instructions });

test('values from the job or the message go into the matching fields', () => {
  assert.deepEqual(check('Claim #', 'CLM-0042'), { ok: true, source: 'Job: Claim number' });
  assert.equal(check('Policy Number', 'HO-77812').ok, true);
  assert.equal(check('Insured Name', 'Jane Testcase').ok, true);
  assert.equal(check('Phone', '(972) 555-0142').source, 'Job brief: Insured phone', 'reformatted phone still traces to its source');
  assert.equal(check('Date of Loss', '2026-10-03').source, 'Job brief: Date of loss', 'reformatted date too');
  assert.equal(check('Email', 'jane.t@example.test').source, 'Your message in Chat');
  assert.equal(check('ZIP', '75023').source, 'Job: Property address (part)');
  assert.equal(check('City', 'Plano').ok, true);
  assert.equal(check('Roof type', 'architectural shingle').ok, true);
  assert.equal(check('Reference number', 'CLM-0042').ok, true, 'a neutral label is fine');
  assert.equal(check('Claim/Policy #', 'HO-77812').ok, true, 'a label that asks for either is fine');
  assert.equal(check('Roof damage', 'checked').ok, true, 'choices need no source');
});

test('a value in the wrong kind of field is refused', () => {
  const swapped = check('Policy number', 'CLM-0042');
  assert.equal(swapped.ok, false);
  assert.match(swapped.problem ?? '', /asks for a policy number, but this value is a claim number/);
  assert.equal(check('Claim number', 'HO-77812').ok, false);
  assert.equal(check('Phone', 'jane.t@example.test').ok, false);
  assert.equal(check('Email address', '972-555-0142').ok, false);
  assert.equal(check('Email', 'Jane Testcase').ok, false, 'a name is not an email');
  assert.equal(check('Date of loss', 'CLM-0042').ok, false);
});

test('a value from nowhere is refused, never typed', () => {
  const made = check('Deductible', '$1,000');
  assert.equal(made.ok, false);
  assert.match(made.problem ?? '', /not in this job's fields or the person's message/);
  assert.equal(check('Insured name', 'John Smith').ok, false);
  assert.equal(check('Claim number', 'CLM-0043').ok, false, 'one digit off is a different value');
});
