import assert from 'node:assert/strict';
import test from 'node:test';
import { homeownerJobFileFromRows } from '../src/verifier/homeownerJobFile.js';

test('homeowner job file includes facts, do-nots, and every scope line — never prices', () => {
  const file = homeownerJobFileFromRows({
    brief: {
      id: 'br-4',
      revision: 4,
      facts: { 'Site address': '2214 Cedar Ridge Dr', Permit: 'BP-2026-8841' },
      note: 'Skylights removed from scope.',
    },
    scope: [
      {
        id: 'sc-1',
        state: 'excluded',
        title: 'Do not remove the skylights',
        reason: 'Carrier declined them.',
        detail: null,
      },
      {
        id: 'sc-2',
        state: 'included',
        title: 'Tear off and replace roof',
        amount: 9800,
      },
    ],
  });

  assert.equal(file.brief?.revision, 4);
  assert.equal(file.brief?.facts['Site address'], '2214 Cedar Ridge Dr');
  assert.equal(file.scope.length, 2);
  assert.equal(file.scope[0]?.state, 'excluded');
  assert.equal(file.scope[0]?.reason, 'Carrier declined them.');
  assert.equal(file.scope[1]?.title, 'Tear off and replace roof');
  assert.equal(file.scope[1]?.amount, null);
});

test('missing brief and empty scope still produce a readable file', () => {
  const file = homeownerJobFileFromRows({});
  assert.equal(file.brief, null);
  assert.deepEqual(file.scope, []);
});
