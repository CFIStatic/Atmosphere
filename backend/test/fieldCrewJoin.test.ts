import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crewNameKey,
  fieldCaptureDeviceEmail,
  fieldCaptureDeviceName,
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

test('field capture device email is stable for a phone inside one office', () => {
  const orgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const deviceId = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
  const email = fieldCaptureDeviceEmail(orgId, deviceId);
  assert.equal(email, fieldCaptureDeviceEmail(orgId, deviceId.toLowerCase()));
  assert.equal(email, 'phone.a1b2c3d4e5f67890abcdef1234567890.aaaaaaaabbbb@field.atmosphere.app');
  assert.equal(fieldCaptureDeviceName(deviceId), 'Field phone 7890');
  assert.equal(isFieldCaptureEmail(email), true);
});

test('field join: name plus company code', () => {
  const parsed = fieldJoinSchema.parse({
    fullName: '  Nick   Smith ',
    joinCode: '  8f3a9c2b ',
    deviceId: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
  });
  assert.equal(parsed.fullName, 'Nick Smith');
  assert.equal(parsed.joinCode, '8F3A9C2B');
  assert.equal(parsed.deviceId, 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890');
});

test('field join: name plus office code without a device id', () => {
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

test('field join: reject a company code with no name', () => {
  assert.throws(() => fieldJoinSchema.parse({ joinCode: '8F3A9C2B' }));
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

test('POST /api/field-app/join accepts a name plus company code at the door', async () => {
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
      body: JSON.stringify({
        fullName: 'Nick Smith',
        joinCode: '8F3A9C2B',
        deviceId: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
      }),
    });
    const body = (await res.json()) as { code?: string };
    assert.notEqual(body.code, 'validation_error');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/field-app/join rejects a company code with no name', async () => {
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
      body: JSON.stringify({ joinCode: '8F3A9C2B' }),
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
