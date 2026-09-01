import test from 'node:test';
import assert from 'node:assert/strict';
import { jobTitleForIntake, proposeIntakeFromText } from '../src/verifier/intakePropose.js';

const SAMPLE = `Property: 1842 Meridian Ave
Austin, TX 78702

Scope of work
1. Extract standing water — living room and hallway
2. Remove wet drywall to 24" on south wall
3. Set air movers and dehumidifier; monitor 3 days
DO NOT: demo kitchen cabinets
DO NOT: open ceilings without written approval

Mitigation — water loss`;

test('proposeIntakeFromText names the job from the site, not a scope line', () => {
  const p = proposeIntakeFromText(SAMPLE);
  assert.match(p.address, /Meridian/i);
  assert.match(p.title, /Meridian/i);
  assert.doesNotMatch(p.title, /Extract standing water/i);
  assert.equal(p.workType, 'mitigation');
  assert.ok(p.scope.some((s) => s.state === 'included' && /Extract standing water/i.test(s.title)));
  assert.ok(p.scope.some((s) => s.state === 'excluded' && /kitchen cabinets/i.test(s.title)));
  assert.equal(p.source, 'heuristic');
});

test('proposeIntakeFromText refuses thin paste without an address', () => {
  assert.throws(() => proposeIntakeFromText('too short'), /site address|few lines/i);
});

test('proposeIntakeFromText allows address-only with empty scope', () => {
  const p = proposeIntakeFromText('', { address: '1842 Meridian Ave, Austin, TX' });
  assert.equal(p.address, '1842 Meridian Ave, Austin, TX');
  assert.equal(p.title, '1842 Meridian Ave');
  assert.deepEqual(p.scope, []);
  assert.match(p.summary, /address/i);
});

test('a short work note with an address becomes one included line', () => {
  const p = proposeIntakeFromText('Extract standing water', {
    address: '1842 Meridian Ave, Austin, TX',
  });
  assert.equal(p.address, '1842 Meridian Ave, Austin, TX');
  assert.equal(p.scope.length, 1);
  assert.equal(p.scope[0]?.state, 'included');
  assert.match(p.scope[0]?.title ?? '', /Extract standing water/);
  assert.match(p.briefNote, /Extract standing water/);
});

test('jobTitleForIntake replaces a numbered scope line with the street', () => {
  assert.equal(
    jobTitleForIntake(
      '1. Extract standing water — living room and hallway',
      '9397 North Heyward Court, Summerville, South Carolina, 29485, US',
    ),
    '9397 North Heyward Court',
  );
  assert.equal(
    jobTitleForIntake('Cedar Ridge rebuild', '4118 Cedar Ridge Dr'),
    'Cedar Ridge rebuild',
  );
});

test('jobTitleForIntake keeps a work-like name when the site line is blank', () => {
  assert.equal(jobTitleForIntake('Extract standing water', ''), 'Extract standing water');
  assert.equal(jobTitleForIntake('Demo kitchen', ''), 'Demo kitchen');
  assert.equal(jobTitleForIntake('Paint the hall', ''), 'Paint the hall');
  assert.equal(jobTitleForIntake('Clean the basement', ''), 'Clean the basement');
});
