import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crewNameKey,
  fieldCaptureEmail,
  isFieldCaptureEmail,
  normalizeCrewName,
} from '../src/field/crewJoin.js';
import { fieldJoinSchema, fieldOfficePreviewSchema } from '../src/lib/validation.js';

test('crew name: collapse spaces and compare case-insensitively', () => {
  assert.equal(normalizeCrewName('  Nick   Smith '), 'Nick Smith');
  assert.equal(crewNameKey('NICK smith'), crewNameKey('Nick Smith'));
});

test('field capture email is stable for a name inside one office', () => {
  const orgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const email = fieldCaptureEmail(orgId, 'Nick Smith');
  assert.equal(email, fieldCaptureEmail(orgId, '  nick   SMITH '));
  assert.equal(email, 'nick.smith.aaaaaaaabbbb@field.atmosphere.app');
  assert.equal(isFieldCaptureEmail(email), true);
  assert.equal(isFieldCaptureEmail('nick@office.example'), false);
});

test('field join: name plus office code', () => {
  const parsed = fieldJoinSchema.parse({
    fullName: '  Nick   Smith ',
    joinCode: '  8f3a9c2b ',
  });
  assert.equal(parsed.fullName, 'Nick Smith');
  assert.equal(parsed.joinCode, '8F3A9C2B');
});

test('field join: reject a first name only', () => {
  assert.throws(() => fieldJoinSchema.parse({ fullName: 'Nick', joinCode: '8F3A9C2B' }));
});

test('field join: reject a missing join code', () => {
  assert.throws(() => fieldJoinSchema.parse({ fullName: 'Nick Smith' }));
});

test('POST /api/field-app/join rejects a first name only before hitting Auth', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/field-app/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Nick', joinCode: '8F3A9C2B' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; code?: string };
    assert.match(body.error ?? '', /first and last name/i);
    assert.equal(body.code, 'validation_error');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/field-app/office/preview is public and rejects a malformed code', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/field-app/office/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinCode: 'NO' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'validation_error');
    fieldOfficePreviewSchema.parse({ joinCode: '8F3A9C2B' });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
