import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accessCodesMatch,
  evaluateInternalStaffGate,
  staffFullName,
} from './internalStaffGate.js';

describe('internal staff gate', () => {
  it('accepts allowlisted email plus matching access code', () => {
    const result = evaluateInternalStaffGate({
      firstName: 'Jack',
      lastName: 'Cyganiak',
      email: 'jack@jettx.ai',
      accessCode: 'secret-code',
      expectedAccessCode: 'secret-code',
      allowlisted: true,
    });
    assert.deepEqual(result, { ok: true, fullName: 'Jack Cyganiak' });
  });

  it('rejects a wrong access code without saying which field failed', () => {
    const result = evaluateInternalStaffGate({
      firstName: 'Jack',
      lastName: 'Cyganiak',
      email: 'jack@jettx.ai',
      accessCode: 'nope',
      expectedAccessCode: 'secret-code',
      allowlisted: true,
    });
    assert.deepEqual(result, { ok: false });
  });

  it('rejects an email that is not on the staff allow-list', () => {
    const result = evaluateInternalStaffGate({
      firstName: 'Sam',
      lastName: 'Stranger',
      email: 'sam@example.com',
      accessCode: 'secret-code',
      expectedAccessCode: 'secret-code',
      allowlisted: false,
    });
    assert.deepEqual(result, { ok: false });
  });

  it('compares access codes in constant time', () => {
    assert.equal(accessCodesMatch('abc', 'abc'), true);
    assert.equal(accessCodesMatch('abc', 'abd'), false);
    assert.equal(accessCodesMatch('abc', ''), false);
  });

  it('joins first and last name', () => {
    assert.equal(staffFullName('  Jack ', ' Cyganiak '), 'Jack Cyganiak');
  });
});

describe('internal staff login schema', () => {
  it('requires first name, last name, email, and access code', async () => {
    const { internalStaffLoginSchema } = await import('./validation.js');
    const parsed = internalStaffLoginSchema.parse({
      firstName: 'Jack',
      lastName: 'Cyganiak',
      email: 'jack@jettx.ai',
      accessCode: 'atmosphere-internal',
    });
    assert.equal(parsed.email, 'jack@jettx.ai');
    assert.throws(() =>
      internalStaffLoginSchema.parse({
        firstName: '',
        lastName: 'Cyganiak',
        email: 'jack@jettx.ai',
        accessCode: 'x',
      }),
    );
  });
});
