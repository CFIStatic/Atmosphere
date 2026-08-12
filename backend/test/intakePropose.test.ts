import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeIntakeFromText } from '../src/verifier/intakePropose.js';

const SAMPLE = `Property: 1842 Meridian Ave
Austin, TX 78702

Scope of work
1. Extract standing water — living room and hallway
2. Remove wet drywall to 24" on south wall
3. Set air movers and dehumidifier; monitor 3 days
DO NOT: demo kitchen cabinets
DO NOT: open ceilings without written approval

Mitigation — water loss`;

test('proposeIntakeFromText drafts job, inclusions, and exclusions', () => {
  const p = proposeIntakeFromText(SAMPLE);
  assert.match(p.address, /Meridian/i);
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
  assert.deepEqual(p.scope, []);
  assert.match(p.summary, /No scope/i);
});
