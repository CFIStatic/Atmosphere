import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crewNameKey,
  fieldCaptureEmail,
  isCrewLoginMember,
  isFieldCaptureEmail,
  normalizeCrewName,
} from '../src/field/crewJoin.js';

test('crew name: collapse spaces and compare case-insensitively', () => {
  assert.equal(normalizeCrewName('  Nick   Smith '), 'Nick Smith');
  assert.equal(crewNameKey('NICK smith'), crewNameKey('Nick Smith'));
});

test('crew login matches remapped employees and Field Capture inboxes', () => {
  assert.equal(isCrewLoginMember('employee', 'nick@office.example'), true);
  assert.equal(isCrewLoginMember('field_technician', 'nick@office.example'), true);
  assert.equal(isCrewLoginMember('global_admin', 'nick@office.example'), false);
  assert.equal(isCrewLoginMember('global_admin', 'nick.smith.aaaa@field.atmosphere.app'), true);
});

test('field capture email is stable for a name inside one office', () => {
  const orgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const email = fieldCaptureEmail(orgId, 'Nick Smith');
  assert.equal(email, fieldCaptureEmail(orgId, '  nick   SMITH '));
  assert.equal(email, 'nick.smith.aaaaaaaabbbb@field.atmosphere.app');
  assert.equal(isFieldCaptureEmail(email), true);
  assert.equal(isFieldCaptureEmail('nick@office.example'), false);
});

test('POST /api/field-app/join is gone', async () => {
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
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/field-app/office/preview is gone', async () => {
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
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
