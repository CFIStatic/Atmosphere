import assert from 'node:assert/strict';
import test from 'node:test';
import { ackDisplayName } from '../src/shared/acknowledgeShareRevision.js';

test('ackDisplayName prefers contact name, then company', () => {
  assert.equal(ackDisplayName({ contact_name: 'Alex', company: 'Rio' }), 'Alex');
  assert.equal(ackDisplayName({ contact_name: '  ', company: 'Rio' }), 'Rio');
  assert.equal(ackDisplayName({ contact_name: null, company: null }), 'Opened invite');
});
