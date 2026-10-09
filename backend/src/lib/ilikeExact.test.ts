import test from 'node:test';
import assert from 'node:assert/strict';
import { ilikeExact } from './ilikeExact.js';

test('ilikeExact escapes LIKE wildcards so emails match only themselves', () => {
  assert.equal(ilikeExact('john_doe@example.com'), 'john\\_doe@example.com');
  assert.equal(ilikeExact('a%b@example.com'), 'a\\%b@example.com');
  assert.equal(ilikeExact('back\\slash@example.com'), 'back\\\\slash@example.com');
  assert.equal(ilikeExact('Plain@Example.com'), 'Plain@Example.com');
  assert.equal(ilikeExact('star*@example.com'), null);
});
